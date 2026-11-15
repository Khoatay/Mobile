"""
FX Desk bridge: chương trình nền chạy trên máy Windows có cài MT5.

- Đọc tài khoản MT5 bằng mật khẩu view (investor): chỉ đọc, không đặt lệnh.
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

def make_handler(mt5, tg):
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
                self.send_header("Vary", "Origin")
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if not self.local_only():
                return self.send(403, {"error": "Chỉ chấp nhận yêu cầu từ chính máy này"})
            url = urlparse(self.path)
            q = {k: v[0] for k, v in parse_qs(url.query).items()}
            try:
                if url.path == "/status":
                    body = {"mt5": mt5.status(), "telegram": {"connected": tg.connected, "error": tg.error, "channels": tg.channels}}
                elif url.path == "/account":
                    body = mt5.account()
                elif url.path == "/history":
                    body = mt5.history(int(q.get("days", 90)))
                elif url.path == "/candles":
                    body = mt5.candles(q["symbol"], q.get("tf", "H1"), int(q.get("count", 300)))
                elif url.path == "/prices":
                    body = mt5.prices([s for s in q.get("symbols", "").split(",") if s])
                elif url.path == "/telegram/messages":
                    body = tg.since(int(q.get("after", 0)))
                else:
                    return self.send(404, {"error": "Không có đường dẫn này"})
            except (KeyError, ValueError) as e:
                return self.send(400, {"error": str(e)})
            except Exception as e:
                return self.send(503, {"error": str(e)})
            self.send(200, body)

    return Handler


def main():
    cfg = load_config()
    tg = Telegram(cfg.get("telegram"))
    if len(sys.argv) > 1 and sys.argv[1] == "login":
        return tg.login()
    mt5 = Mt5(cfg.get("mt5"))
    print("[mt5] Đã kết nối" if mt5.connect() else f"[mt5] {mt5.error}")
    tg.start()
    port = int(cfg.get("port", 8787))
    server = ThreadingHTTPServer(("127.0.0.1", port), make_handler(mt5, tg))
    print(f"FX Desk bridge đang chạy tại http://127.0.0.1:{port} (Ctrl+C để dừng)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
