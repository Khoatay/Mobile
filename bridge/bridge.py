"""
FX Desk bridge: chương trình nền chạy trên máy Windows có cài MT5.

- Đọc nhiều tài khoản MT5 cùng lúc. Mỗi tài khoản chạy trong một tiến trình riêng, nối với một bản MT5
  cài ở thư mục riêng (một bản MT5 chỉ đăng nhập được một tài khoản tại một thời điểm).
- Mật khẩu view (investor) là đủ để xem. Muốn vào lệnh từ app thì tài khoản đó phải dùng mật khẩu
  giao dịch và bật "allow_trading": true; mặc định là tắt.
- Nghe các kênh Telegram bạn chọn bằng tài khoản Telegram của bạn.
- Chỉ mở cổng trên 127.0.0.1 và chỉ trả lời trang web chạy trên chính máy này.

Dùng:
    pip install -r requirements.txt
    copy config.example.json config.json   (rồi điền thông tin)
    python bridge.py login                 (đăng nhập Telegram lần đầu, liệt kê kênh)
    python bridge.py                       (chạy)
"""
import asyncio
import json
import multiprocessing as mp
import sys
import threading
import time
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HERE = Path(__file__).resolve().parent
CONFIG_PATH = HERE / "config.json"
LOCAL_HOSTS = {"127.0.0.1", "localhost"}


def load_config():
    if not CONFIG_PATH.exists():
        sys.exit("Chưa có config.json. Hãy sao chép config.example.json thành config.json rồi điền thông tin.")
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


# ----------------------------------------------------------------------------- MT5

class Mt5:
    """Mọi lời gọi tới thư viện MetaTrader5 đi qua một khoá, vì thư viện không an toàn đa luồng."""

    TIMEFRAMES = ("M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1")

    def __init__(self, cfg):
        self.cfg = cfg or {}
        self.lock = threading.RLock()
        self.error = "Chưa kết nối"
        self.connected = False
        self.mt5 = None
        self._symbols = {}

    def connect(self):
        with self.lock:
            try:
                import MetaTrader5 as mt5  # chỉ có trên Windows
            except ImportError:
                self.error = "Chưa cài thư viện MetaTrader5 (chỉ chạy trên Windows): pip install MetaTrader5"
                return False
            self.mt5 = mt5
            if not self.cfg.get("login"):
                self.error = "Chưa điền mt5.login trong config.json"
                return False
            kwargs = dict(login=int(self.cfg["login"]), password=str(self.cfg.get("password", "")), server=str(self.cfg.get("server", "")))
            if self.cfg.get("portable"):
                kwargs["portable"] = True
            path = self.cfg.get("terminal_path")
            ok = mt5.initialize(path, **kwargs) if path else mt5.initialize(**kwargs)
            self.connected = bool(ok)
            self.error = "" if ok else f"MT5 từ chối kết nối: {mt5.last_error()}"
            self._symbols = {}
            return self.connected

    def ensure(self):
        with self.lock:
            if self.connected and self.mt5.account_info() is not None:
                return True
            return self.connect()

    def status(self):
        with self.lock:
            out = {"connected": self.connected, "error": self.error}
            if self.connected:
                info = self.mt5.account_info()
                if info is None:
                    self.connected = False
                    out.update(connected=False, error="Mất kết nối tới MT5")
                else:
                    out.update(login=info.login, server=info.server)
            return out

    def account(self):
        with self.lock:
            if not self.ensure():
                raise RuntimeError(self.error)
            mt5 = self.mt5
            a = mt5.account_info()
            positions = []
            for p in mt5.positions_get() or ():
                positions.append({
                    "ticket": p.ticket, "symbol": p.symbol, "side": "buy" if p.type == 0 else "sell",
                    "volume": p.volume, "openPrice": p.price_open, "price": p.price_current,
                    "sl": p.sl, "tp": p.tp, "profit": p.profit, "swap": p.swap, "time": p.time,
                })
            return {
                "login": a.login, "server": a.server, "name": a.name, "currency": a.currency,
                "balance": a.balance, "equity": a.equity, "profit": a.profit,
                "margin": a.margin, "marginFree": a.margin_free, "leverage": a.leverage,
                "positions": positions,
            }

    def history(self, days):
        """Trả deal và order thô; trang web tự ghép thành lệnh đã đóng."""
        with self.lock:
            if not self.ensure():
                raise RuntimeError(self.error)
            mt5 = self.mt5
            # Giờ máy chủ có thể đi trước giờ máy tính, nên lấy dư 2 ngày về phía tương lai.
            start, end = datetime.now() - timedelta(days=days), datetime.now() + timedelta(days=2)
            deals = [{
                "ticket": d.ticket, "positionId": d.position_id, "time": d.time, "type": d.type, "entry": d.entry,
                "symbol": d.symbol, "volume": d.volume, "price": d.price,
                "commission": d.commission, "fee": getattr(d, "fee", 0.0), "swap": d.swap, "profit": d.profit,
            } for d in mt5.history_deals_get(start, end) or ()]
            orders = [{
                "positionId": o.position_id, "time": o.time_setup, "sl": o.sl, "tp": o.tp,
            } for o in mt5.history_orders_get(start, end) or ()]
            return {"deals": deals, "orders": orders}

    def resolve(self, symbol):
        """EURUSD -> tên thật ở broker (EURUSD.m, EURUSDpro...)."""
        with self.lock:
            key = "".join(c for c in symbol.upper() if c.isalnum())
            if key in self._symbols:
                return self._symbols[key]
            mt5 = self.mt5
            name = None
            if mt5.symbol_info(symbol) is not None:
                name = symbol
            else:
                matches = [s.name for s in mt5.symbols_get() or () if "".join(c for c in s.name.upper() if c.isalnum()).startswith(key)]
                if matches:
                    name = min(matches, key=len)
            if name:
                mt5.symbol_select(name, True)
                self._symbols[key] = name
            return name

    def candles(self, symbol, tf, count):
        with self.lock:
            if not self.ensure():
                raise RuntimeError(self.error)
            if tf not in self.TIMEFRAMES:
                raise ValueError(f"Khung thời gian không hỗ trợ: {tf}")
            name = self.resolve(symbol)
            if not name:
                raise ValueError(f"Broker không có mã {symbol}")
            rates = self.mt5.copy_rates_from_pos(name, getattr(self.mt5, "TIMEFRAME_" + tf), 0, max(1, min(count, 20000)))
            if rates is None:
                raise RuntimeError(f"Không lấy được nến {symbol}: {self.mt5.last_error()}")
            return [{"t": int(r["time"]), "o": float(r["open"]), "h": float(r["high"]), "l": float(r["low"]), "c": float(r["close"])} for r in rates]

    def prices(self, symbols):
        with self.lock:
            if not self.ensure():
                raise RuntimeError(self.error)
            out = {}
            for s in symbols:
                name = self.resolve(s)
                tick = self.mt5.symbol_info_tick(name) if name else None
                if tick is not None and tick.bid > 0:
                    out[s] = {"bid": tick.bid, "ask": tick.ask, "time": tick.time}
            return out


    # ------------------------------------------------------------- vào / đóng lệnh

    def _tradable(self):
        if not self.cfg.get("allow_trading"):
            raise ValueError('Tài khoản này chưa bật "allow_trading" trong config.json')
        if not self.ensure():
            raise RuntimeError(self.error)

    def _filling(self, info):
        mt5 = self.mt5
        mode = int(getattr(info, "filling_mode", 0))
        return mt5.ORDER_FILLING_FOK if mode & 1 else mt5.ORDER_FILLING_IOC if mode & 2 else mt5.ORDER_FILLING_RETURN

    def _send(self, request):
        """Luôn hỏi MT5 kiểm tra trước (order_check) rồi mới gửi thật."""
        mt5 = self.mt5
        check = mt5.order_check(request)
        if check is None or check.retcode not in (0, mt5.TRADE_RETCODE_DONE):
            raise RuntimeError(f"MT5 không chấp nhận lệnh: {check.comment if check else mt5.last_error()}")
        result = mt5.order_send(request)
        if result is None or result.retcode != mt5.TRADE_RETCODE_DONE:
            raise RuntimeError(f"Lệnh không khớp: {(str(result.retcode) + ' ' + result.comment) if result else mt5.last_error()}")
        print(f"[lệnh] tài khoản {self.cfg.get('login')}: {request['symbol']} {request['volume']} lot, deal {result.deal}, giá {result.price}")
        return {"order": result.order, "deal": result.deal, "price": result.price, "volume": result.volume}

    def order(self, p):
        """Lệnh thị trường. Bắt buộc có stop loss đúng phía, khối lượng không vượt max_lot của tài khoản."""
        with self.lock:
            self._tradable()
            mt5 = self.mt5
            side = p.get("side")
            if side not in ("buy", "sell"):
                raise ValueError("side phải là buy hoặc sell")
            volume, sl, tp = float(p.get("volume") or 0), float(p.get("sl") or 0), float(p.get("tp") or 0)
            max_lot = float(self.cfg.get("max_lot", 1.0))
            if not 0 < volume <= max_lot:
                raise ValueError(f"Khối lượng phải lớn hơn 0 và không quá max_lot = {max_lot}")
            if sl <= 0:
                raise ValueError("Bắt buộc phải có stop loss")
            name = self.resolve(str(p.get("symbol", "")))
            if not name:
                raise ValueError(f"Broker không có mã {p.get('symbol')}")
            info, tick = mt5.symbol_info(name), mt5.symbol_info_tick(name)
            if info is None or tick is None or tick.ask <= 0:
                raise RuntimeError(f"Không có giá cho {name}")
            buy = side == "buy"
            price = tick.ask if buy else tick.bid
            if (sl >= price) if buy else (sl <= price):
                raise ValueError(f"Stop loss {sl} nằm sai phía so với giá {price}")
            if tp and ((tp <= price) if buy else (tp >= price)):
                raise ValueError(f"Take profit {tp} nằm sai phía so với giá {price}")
            step = info.volume_step or 0.01
            volume = round(int(volume / step + 1e-9) * step, 8)
            if volume < info.volume_min:
                raise ValueError(f"Khối lượng nhỏ hơn mức tối thiểu {info.volume_min} của {name}")
            return self._send({
                "action": mt5.TRADE_ACTION_DEAL, "symbol": name, "volume": volume,
                "type": mt5.ORDER_TYPE_BUY if buy else mt5.ORDER_TYPE_SELL, "price": price,
                "sl": sl, "tp": tp, "deviation": 20, "magic": 20261115, "comment": "FX Desk",
                "type_time": mt5.ORDER_TIME_GTC, "type_filling": self._filling(info),
            })

    def close(self, ticket):
        with self.lock:
            self._tradable()
            mt5 = self.mt5
            found = mt5.positions_get(ticket=int(ticket)) or ()
            if not found:
                raise ValueError(f"Không thấy lệnh đang mở số {ticket}")
            pos = found[0]
            info, tick = mt5.symbol_info(pos.symbol), mt5.symbol_info_tick(pos.symbol)
            if info is None or tick is None:
                raise RuntimeError(f"Không có giá cho {pos.symbol}")
            was_buy = pos.type == 0
            return self._send({
                "action": mt5.TRADE_ACTION_DEAL, "symbol": pos.symbol, "volume": pos.volume, "position": pos.ticket,
                "type": mt5.ORDER_TYPE_SELL if was_buy else mt5.ORDER_TYPE_BUY, "price": tick.bid if was_buy else tick.ask,
                "deviation": 20, "magic": 20261115, "comment": "FX Desk close",
                "type_time": mt5.ORDER_TIME_GTC, "type_filling": self._filling(info),
            })


def worker_main(cfg, conn):
    """Tiến trình con: giữ một kết nối MT5 và làm lần lượt từng yêu cầu gửi qua ống."""
    m = Mt5(cfg)
    m.connect()
    while True:
        try:
            method, args = conn.recv()
        except (EOFError, KeyboardInterrupt):
            return
        try:
            conn.send(("ok", getattr(m, method)(*args)))
        except (KeyError, ValueError) as e:
            conn.send(("bad", str(e)))
        except Exception as e:
            conn.send(("err", str(e)))


class Account:
    """Một tài khoản MT5 = một tiến trình con. Tiến trình chính chỉ chuyển yêu cầu."""

    TYPES = ("real", "prop", "copy", "demo")

    def __init__(self, cfg):
        self.cfg = cfg
        self.id = str(cfg.get("id") or cfg.get("login"))
        self.label = str(cfg.get("label") or self.id)
        self.type = cfg.get("type") if cfg.get("type") in self.TYPES else "real"
        self.tradable = bool(cfg.get("allow_trading"))
        self.lock = threading.Lock()
        self.last = {"connected": False, "error": "Đang kết nối…"}
        self.start()

    def start(self):
        self.conn, child = mp.Pipe()
        self.proc = mp.Process(target=worker_main, args=(self.cfg, child), daemon=True)
        self.proc.start()

    def _call(self, method, args, timeout):
        if not self.proc.is_alive():
            self.start()
        self.conn.send((method, args))
        if not self.conn.poll(timeout):
            self.proc.kill()
            raise RuntimeError("MT5 không trả lời, đang khởi động lại kết nối")
        kind, value = self.conn.recv()
        if kind == "bad":
            raise ValueError(value)
        if kind == "err":
            raise RuntimeError(value)
        return value

    def call(self, method, *args, timeout=60):
        with self.lock:
            return self._call(method, args, timeout)

    def info(self):
        """Không chờ nếu tài khoản đang bận (ví dụ MT5 còn đang mở): trả trạng thái gần nhất."""
        if self.lock.acquire(timeout=0.3):
            try:
                self.last = self._call("status", (), 20)
            except Exception as e:
                self.last = {"connected": False, "error": str(e)}
            finally:
                self.lock.release()
        return {"id": self.id, "label": self.label, "type": self.type, "tradable": self.tradable, **self.last}


def load_accounts(cfg):
    raw = cfg.get("accounts") or ([cfg["mt5"]] if cfg.get("mt5", {}).get("login") else [])
    raw = [a for a in raw if a.get("login")]
    paths = [str(a.get("terminal_path") or "").lower() for a in raw]
    if len(set(paths)) < len(paths):
        sys.exit(
            "Mỗi tài khoản cần một bản MT5 ở thư mục riêng: hãy điền terminal_path khác nhau cho từng tài khoản.\n"
            "Cách làm: cài MT5 thêm lần nữa vào thư mục khác, hoặc sao chép cả thư mục MT5 rồi đặt \"portable\": true."
        )
    ids = [str(a.get("id") or a.get("login")) for a in raw]
    if len(set(ids)) < len(ids):
        sys.exit("Có hai tài khoản trùng id/login trong config.json.")
    return [Account(a) for a in raw]


# ------------------------------------------------------------------------ Telegram

class Telegram:
    """Chạy Telethon trong một luồng riêng; tin nhắn giữ trong bộ nhớ."""

    def __init__(self, cfg):
        self.cfg = cfg or {}
        self.lock = threading.Lock()
        self.messages = []
        self.channels = []
        self.connected = False
        self.error = "Chưa cấu hình Telegram"

    def enabled(self):
        return bool(self.cfg.get("api_id") and self.cfg.get("api_hash"))

    def client(self):
        from telethon import TelegramClient
        return TelegramClient(str(HERE / "fxdesk"), int(self.cfg["api_id"]), str(self.cfg["api_hash"]))

    def add(self, title, msg):
        text = msg.message or ""
        if not text.strip():
            return
        with self.lock:
            self.messages.append({"channel": title, "id": msg.id, "date": int(msg.date.timestamp()), "text": text})
            del self.messages[:-5000]

    async def resolve(self, client):
        """Chấp nhận @username, link t.me, id số, hoặc đúng tên hiển thị của kênh."""
        wanted = [str(c).strip() for c in self.cfg.get("channels", []) if str(c).strip()]
        by_title = {}
        async for d in client.iter_dialogs():
            by_title[d.name.strip().lower()] = d.entity
        found = []
        for w in wanted:
            entity = by_title.get(w.lower())
            if entity is None:
                try:
                    entity = await client.get_entity(int(w) if w.lstrip("-").isdigit() else w)
                except Exception as e:  # kênh sai tên không được làm hỏng các kênh còn lại
                    print(f"[telegram] Không tìm thấy kênh '{w}': {e}")
                    continue
            found.append(entity)
        return found

    async def run(self):
        from telethon import events
        from telethon.utils import get_display_name
        client = self.client()
        await client.connect()
        if not await client.is_user_authorized():
            self.error = "Chưa đăng nhập Telegram. Chạy: python bridge.py login"
            return
        entities = await self.resolve(client)
        if not entities:
            self.error = "Không tìm thấy kênh nào trong config.json"
            return
        titles = {e.id: get_display_name(e) for e in entities}
        limit = int(self.cfg.get("history_per_channel", 200))
        for e in entities:
            async for m in client.iter_messages(e, limit=limit):
                self.add(titles[e.id], m)

        @client.on(events.NewMessage(chats=entities))
        async def on_message(event):
            chat = await event.get_chat()
            self.add(titles.get(chat.id, get_display_name(chat)), event.message)

        self.channels = list(titles.values())
        self.connected, self.error = True, ""
        print(f"[telegram] Đang nghe {len(entities)} kênh: {', '.join(self.channels)}")
        await client.run_until_disconnected()
        self.connected, self.error = False, "Mất kết nối Telegram"

    def start(self):
        if not self.enabled():
            return
        def target():
            try:
                asyncio.run(self.run())
            except ImportError:
                self.error = "Chưa cài telethon: pip install telethon"
            except Exception as e:
                self.connected, self.error = False, f"Lỗi Telegram: {e}"
        threading.Thread(target=target, daemon=True).start()

    def login(self):
        """Đăng nhập tương tác (số điện thoại, mã xác nhận) rồi liệt kê kênh đang tham gia."""
        if not self.enabled():
            sys.exit("Hãy điền telegram.api_id và telegram.api_hash trong config.json (lấy tại my.telegram.org).")

        async def go():
            client = self.client()
            await client.start()
            print("\nĐăng nhập xong. Các kênh và nhóm bạn đang tham gia:\n")
            async for d in client.iter_dialogs():
                if d.is_channel or d.is_group:
                    print(f"  {d.name}")
            print('\nChép đúng tên kênh muốn theo dõi vào "channels" trong config.json rồi chạy: python bridge.py')
            await client.disconnect()

        asyncio.run(go())

    def since(self, after):
        with self.lock:
            return sorted((m for m in self.messages if m["date"] > after), key=lambda m: m["date"])


# ---------------------------------------------------------------------------- HTTP

def make_handler(accounts, tg):
    by_id = {a.id: a for a in accounts}

    def pick(q):
        """Tài khoản theo ?account=...; không ghi thì lấy tài khoản đầu tiên (dùng cho nến và tỷ giá)."""
        if q.get("account"):
            if q["account"] not in by_id:
                raise ValueError(f"Không có tài khoản {q['account']}")
            return by_id[q["account"]]
        if not accounts:
            raise RuntimeError("Chưa khai báo tài khoản MT5 nào trong config.json")
        return accounts[0]

    def snapshot(a):
        try:
            return {"id": a.id, "label": a.label, "type": a.type, "tradable": a.tradable, "connected": True, "error": "", **a.call("account")}
        except Exception as e:
            return {"id": a.id, "label": a.label, "type": a.type, "tradable": a.tradable, "connected": False, "error": str(e)}

    def parallel(fn):
        out = [None] * len(accounts)
        def run(i):
            out[i] = fn(accounts[i])
        threads = [threading.Thread(target=run, args=(i,)) for i in range(len(accounts))]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        return out

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def local_only(self):
            """Chặn trang web lạ đọc dữ liệu tài khoản qua trình duyệt (CORS, DNS rebinding)."""
            host = (self.headers.get("Host") or "").rsplit(":", 1)[0]
            origin = self.headers.get("Origin")
            origin_host = urlparse(origin).hostname if origin else None
            return host in LOCAL_HOSTS and (origin is None or origin_host in LOCAL_HOSTS)

        def send(self, code, body):
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            origin = self.headers.get("Origin")
            if origin and urlparse(origin).hostname in LOCAL_HOSTS:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Access-Control-Allow-Headers", "Content-Type, X-FXDesk")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Vary", "Origin")
            self.end_headers()
            self.wfile.write(data)

        def answer(self, fn):
            try:
                body = fn()
            except (KeyError, ValueError) as e:
                return self.send(400, {"error": str(e)})
            except Exception as e:
                return self.send(503, {"error": str(e)})
            self.send(200, body)

        def do_OPTIONS(self):
            self.send(200 if self.local_only() else 403, {})

        def do_GET(self):
            if not self.local_only():
                return self.send(403, {"error": "Chỉ chấp nhận yêu cầu từ chính máy này"})
            url = urlparse(self.path)
            q = {k: v[0] for k, v in parse_qs(url.query).items()}
            routes = {
                "/status": lambda: {"accounts": parallel(lambda a: a.info()), "telegram": {"connected": tg.connected, "error": tg.error, "channels": tg.channels}},
                "/accounts": lambda: parallel(snapshot),
                "/history": lambda: pick(q).call("history", int(q.get("days", 90))),
                "/candles": lambda: pick(q).call("candles", q["symbol"], q.get("tf", "H1"), int(q.get("count", 300))),
                "/prices": lambda: pick(q).call("prices", [s for s in q.get("symbols", "").split(",") if s]),
                "/telegram/messages": lambda: tg.since(int(q.get("after", 0))),
            }
            if url.path not in routes:
                return self.send(404, {"error": "Không có đường dẫn này"})
            self.answer(routes[url.path])

        def do_POST(self):
            # Tiêu đề riêng buộc trình duyệt hỏi trước (preflight), nên form trên trang web lạ không gửi lệnh được.
            if not self.local_only() or self.headers.get("X-FXDesk") != "1":
                return self.send(403, {"error": "Chỉ chấp nhận yêu cầu từ FX Desk trên chính máy này"})
            url = urlparse(self.path)
            try:
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
            except ValueError:
                return self.send(400, {"error": "Dữ liệu gửi lên không phải JSON"})
            if url.path == "/order":
                self.answer(lambda: pick({"account": str(body["account"])}).call("order", body))
            elif url.path == "/close":
                self.answer(lambda: pick({"account": str(body["account"])}).call("close", int(body["ticket"])))
            else:
                self.send(404, {"error": "Không có đường dẫn này"})

    return Handler


def main():
    cfg = load_config()
    tg = Telegram(cfg.get("telegram"))
    if len(sys.argv) > 1 and sys.argv[1] == "login":
        return tg.login()
    accounts = load_accounts(cfg)
    for a in accounts:
        print(f"[mt5] {a.label} ({a.type}){' — CHO PHÉP VÀO LỆNH' if a.tradable else ''}: đang kết nối…")
    tg.start()
    port = int(cfg.get("port", 8787))
    server = ThreadingHTTPServer(("127.0.0.1", port), make_handler(accounts, tg))
    print(f"FX Desk bridge đang chạy tại http://127.0.0.1:{port} (Ctrl+C để dừng)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
