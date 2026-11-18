"""
FX Desk bridge: chương trình nền chạy trên máy Windows có cài MT5.

- Đọc nhiều tài khoản MT5 cùng lúc. Mỗi tài khoản chạy trong một tiến trình riêng, nối với một bản MT5
  cài ở thư mục riêng (một bản MT5 chỉ đăng nhập được một tài khoản tại một thời điểm).
- Mật khẩu view (investor) là đủ để xem. Muốn vào lệnh từ app thì tài khoản đó phải dùng mật khẩu
  giao dịch và bật "allow_trading": true; mặc định là tắt.
- Nghe các kênh Telegram bạn chọn bằng tài khoản Telegram của bạn, và gửi bài (chữ kèm ảnh) lên
  những nhóm bạn liệt kê trong "post_targets". Không gửi được tới nơi nào ngoài danh sách đó.
- Lấy lịch kinh tế trong tuần.
- Chỉ mở cổng trên 127.0.0.1 và chỉ trả lời trang web chạy trên chính máy này.

Dùng:
    pip install -r requirements.txt
    copy config.example.json config.json   (rồi điền thông tin)
    python bridge.py login                 (đăng nhập Telegram lần đầu, liệt kê kênh)
    python bridge.py                       (chạy)
"""
import asyncio
import base64
import io
import json
import math
import multiprocessing as mp
import os
import sys
import threading
import time
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

from automation import Automation
from brain import Brain, Knowledge, Personas, chat

HERE = Path(__file__).resolve().parent
CONFIG_PATH = HERE / "config.json"
LOCAL_HOSTS = {"127.0.0.1", "localhost"}


def load_config():
    if not CONFIG_PATH.exists():
        print("Chưa có config.json: tạo file trống. Hãy thêm tài khoản ở trang Tài khoản MT5 trong app.")
        save_config({"accounts": []})
    try:
        return json.loads(CONFIG_PATH.read_text(encoding="utf-8-sig"))
    except ValueError as e:
        sys.exit(f"config.json sai cú pháp: {e}\nThường do thiếu dấu phẩy, thiếu ngoặc kép, hoặc dùng một dấu \\ thay vì \\\\ trong đường dẫn.")


def save_config(cfg):
    """Ghi ra file tạm rồi đổi tên, để mất điện giữa chừng không làm hỏng config.json."""
    tmp = CONFIG_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, CONFIG_PATH)


def find_terminals():
    """Tìm các bản MT5 (terminal64.exe) ở những nơi bộ cài hay đặt, sâu tối đa 2 cấp thư mục."""
    roots = [os.environ.get(k) for k in ("ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA")] + ["C:\\MT5"]
    found = []
    for root in filter(None, roots):
        if not os.path.isdir(root):
            continue
        for first in os.scandir(root):
            if not first.is_dir():
                continue
            candidates = [first.path] + ([d.path for d in os.scandir(first.path) if d.is_dir()] if first.name.lower() == "programs" else [])
            for folder in candidates:
                exe = os.path.join(folder, "terminal64.exe")
                if os.path.isfile(exe):
                    found.append(exe)
    return sorted(set(found), key=str.lower)


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
                    "comment": getattr(p, "comment", ""), "magic": getattr(p, "magic", 0),
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
        if request.get("action") == mt5.TRADE_ACTION_SLTP:
            print(f"[sửa] tài khoản {self.cfg.get('login')}: {request['symbol']} #{request.get('position')} SL {request.get('sl')} TP {request.get('tp')}")
        else:
            print(f"[lệnh] tài khoản {self.cfg.get('login')}: {request['symbol']} {request.get('volume')} lot, deal {result.deal}, giá {result.price}")
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

    def close_all(self, reason="FX Desk guard"):
        """Đóng mọi lệnh đang mở. Trả về số lệnh đã đóng và lỗi nếu có (không dừng giữa chừng)."""
        with self.lock:
            self._tradable()
            done, errors = 0, []
            for pos in self.mt5.positions_get() or ():
                try:
                    self.close(pos.ticket)
                    done += 1
                except Exception as e:
                    errors.append(f"{pos.symbol} #{pos.ticket}: {e}")
            return {"closed": done, "errors": errors}

    def modify(self, ticket, sl, tp):
        """Đổi SL/TP của một lệnh đang mở."""
        with self.lock:
            self._tradable()
            mt5 = self.mt5
            found = mt5.positions_get(ticket=int(ticket)) or ()
            if not found:
                raise ValueError(f"Không thấy lệnh đang mở số {ticket}")
            pos = found[0]
            return self._send({"action": mt5.TRADE_ACTION_SLTP, "symbol": pos.symbol, "position": pos.ticket, "sl": float(sl or 0), "tp": float(tp or 0)})

    def emergency_stops(self, budget, min_move_points=5):
        """SL khẩn cấp phía sàn: siết SL sao cho nếu mọi lệnh cùng chạm SL thì tổng lỗ không vượt `budget` (tiền tài khoản).
        Chạy cả khi bridge/máy tắt vì SL nằm trên máy chủ sàn. Chỉ siết, không bao giờ nới SL người dùng đã đặt.
        Mỗi lệnh được giữ phần đang lỗ hiện tại, cộng một phần chia đều của khoảng còn lại; lệnh nào SL sẵn đã nằm trong
        phần của mình thì giữ nguyên, phần dư dồn cho các lệnh khác."""
        with self.lock:
            self._tradable()
            mt5 = self.mt5
            plans = []
            for p in mt5.positions_get() or ():
                info, tick = mt5.symbol_info(p.symbol), mt5.symbol_info_tick(p.symbol)
                if info is None or tick is None or not info.point:
                    continue
                buy = p.type == 0
                d = 1000 * info.point
                per = mt5.order_calc_profit(mt5.ORDER_TYPE_BUY if buy else mt5.ORDER_TYPE_SELL, p.symbol, p.volume, p.price_open, p.price_open + (d if buy else -d))
                if not per or per <= 0:
                    continue
                pp = per / d  # tiền lãi/lỗ khi giá đi 1.0 theo chiều lệnh
                sgn = 1 if buy else -1
                loss_at = lambda price, p=p, sgn=sgn, pp=pp: -((price - p.price_open) * sgn * pp + p.swap)
                base = max(0.0, loss_at(tick.bid if buy else tick.ask))  # đang lỗ bao nhiêu ở giá hiện tại
                extra = (loss_at(p.sl) - base) if p.sl > 0 else float("inf")  # SL hiện tại cho lỗ thêm bao nhiêu
                plans.append({"p": p, "info": info, "tick": tick, "buy": buy, "pp": pp, "sgn": sgn, "base": base, "extra": extra})
            left = float(budget) - sum(x["base"] for x in plans)  # khoảng lỗ thêm còn được phép, chia cho các lệnh
            plans.sort(key=lambda x: x["extra"])
            n = len(plans)
            changed, over, errors = [], [], []
            for i, x in enumerate(plans):
                share = left / (n - i)
                if x["extra"] <= share:
                    left -= x["extra"]
                    continue
                left -= share
                p, info, tick = x["p"], x["info"], x["tick"]
                if share <= 0:
                    over.append(f"{p.symbol} #{p.ticket}")
                    continue
                raw = p.price_open - x["sgn"] * (x["base"] + share + p.swap) / x["pp"]
                pt = info.point
                sl = (math.ceil(raw / pt - 1e-9) if x["buy"] else math.floor(raw / pt + 1e-9)) * pt  # làm tròn về phía chặt hơn
                sl = round(sl, info.digits)
                gap = max(info.trade_stops_level, info.trade_freeze_level, 1) * pt
                if (x["buy"] and sl >= tick.bid - gap) or (not x["buy"] and sl <= tick.ask + gap):
                    over.append(f"{p.symbol} #{p.ticket}")  # đã lỗ quá phần của mình: để bảo vệ đóng lệnh
                    continue
                if p.sl > 0 and (sl <= p.sl if x["buy"] else sl >= p.sl):
                    continue
                if p.sl > 0 and abs(sl - p.sl) < min_move_points * pt:
                    continue
                try:
                    self._send({"action": mt5.TRADE_ACTION_SLTP, "symbol": p.symbol, "position": p.ticket, "sl": sl, "tp": p.tp})
                    changed.append({"ticket": p.ticket, "symbol": p.symbol, "old": p.sl, "new": sl})
                except Exception as e:
                    errors.append(f"{p.symbol} #{p.ticket}: {e}")
            return {"changed": changed, "over": over, "errors": errors, "positions": n}

    def copy_open(self, p):
        """Mở lệnh chép từ tài khoản nguồn. Giống order() nhưng cho phép SL trống nếu lệnh nguồn không có SL."""
        with self.lock:
            self._tradable()
            mt5 = self.mt5
            name = self.resolve(str(p["symbol"]))
            if not name:
                raise ValueError(f"Broker không có mã {p['symbol']}")
            info, tick = mt5.symbol_info(name), mt5.symbol_info_tick(name)
            if info is None or tick is None or tick.ask <= 0:
                raise RuntimeError(f"Không có giá cho {name}")
            step = info.volume_step or 0.01
            max_lot = float(self.cfg.get("max_lot", 1.0))
            volume = min(float(p["volume"]), max_lot)
            volume = round(int(volume / step + 1e-9) * step, 8)
            if volume < info.volume_min:
                raise ValueError(f"Khối lượng {volume} nhỏ hơn mức tối thiểu {info.volume_min} của {name}")
            buy = p["side"] == "buy"
            return self._send({
                "action": mt5.TRADE_ACTION_DEAL, "symbol": name, "volume": volume,
                "type": mt5.ORDER_TYPE_BUY if buy else mt5.ORDER_TYPE_SELL, "price": tick.ask if buy else tick.bid,
                "sl": float(p.get("sl") or 0), "tp": float(p.get("tp") or 0), "deviation": 20, "magic": 20261116,
                "comment": str(p.get("comment", ""))[:31], "type_time": mt5.ORDER_TIME_GTC, "type_filling": self._filling(info),
            })

    def today(self, server_offset):
        """Kết quả hôm nay theo ngày máy chủ: lãi/lỗ đã chốt, số lệnh, chuỗi thua liên tiếp hiện tại."""
        with self.lock:
            if not self.ensure():
                raise RuntimeError(self.error)
            day0 = int((time.time() + float(server_offset) * 3600) // 86400 * 86400)
            deals = [d for d in self.mt5.history_deals_get(datetime.now() - timedelta(days=3), datetime.now() + timedelta(days=2)) or () if d.time >= day0]
            closed, by_pos, opened = 0.0, {}, set()
            for d in sorted(deals, key=lambda x: x.time):
                if d.type not in (0, 1):
                    continue
                net = d.profit + d.commission + d.swap + getattr(d, "fee", 0.0)
                closed += net
                if d.entry == 0:
                    opened.add(d.position_id)
                else:
                    by_pos.setdefault(d.position_id, [0.0, d.time])
                    by_pos[d.position_id][0] += net
                    by_pos[d.position_id][1] = d.time
            streak = 0
            for net, _ in sorted(by_pos.values(), key=lambda x: x[1]):
                streak = streak + 1 if net < 0 else 0
            return {"closed_pnl": round(closed, 2), "trades": len(opened), "consec_losses": streak, "day_start": day0}


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

    def stop(self):
        try:
            self.proc.kill()
        except Exception:
            pass

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


class Registry:
    """Danh sách tài khoản đang chạy, đồng bộ với config.json. Thêm và gỡ được khi bridge đang chạy."""

    FIELDS = ("id", "label", "type", "login", "password", "server", "terminal_path", "portable", "allow_trading", "max_lot")

    def __init__(self, cfg):
        self.cfg = cfg
        self.lock = threading.Lock()
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
        self.items = [Account(a) for a in raw]

    def list(self):
        with self.lock:
            return list(self.items)

    def get(self, account_id):
        with self.lock:
            return next((a for a in self.items if a.id == account_id), None)

    def _persist(self):
        self.cfg.pop("mt5", None)
        self.cfg["accounts"] = [a.cfg for a in self.items]
        save_config(self.cfg)

    def add(self, body):
        try:
            login = int(str(body.get("login", "")).strip())
        except ValueError:
            raise ValueError("Số tài khoản phải là số")
        password, server = str(body.get("password") or ""), str(body.get("server") or "").strip()
        path = str(body.get("terminal_path") or "").strip().strip('"')
        if not password or not server:
            raise ValueError("Cần nhập mật khẩu và tên máy chủ")
        if not path.lower().endswith("terminal64.exe") or not os.path.isfile(path):
            raise ValueError(f"Không thấy file terminal64.exe tại: {path}")
        cfg = {
            "id": str(login), "label": str(body.get("label") or login).strip()[:40],
            "type": body.get("type") if body.get("type") in Account.TYPES else "real",
            "login": login, "password": password, "server": server, "terminal_path": path,
        }
        if body.get("allow_trading"):
            cfg["allow_trading"] = True
            cfg["max_lot"] = max(0.01, float(body.get("max_lot") or 0.1))
        with self.lock:
            if any(a.id == cfg["id"] for a in self.items):
                raise ValueError(f"Tài khoản {login} đã có trong danh sách")
            owner = next((a for a in self.items if str(a.cfg.get("terminal_path", "")).lower() == path.lower()), None)
            if owner:
                raise ValueError(f"Bản MT5 này đang dùng cho \"{owner.label}\". Mỗi tài khoản cần một bản MT5 riêng")
            account = Account(cfg)
            self.items.append(account)
            self._persist()
        print(f"[mt5] Đã thêm {account.label} ({account.type}){' — CHO PHÉP VÀO LỆNH' if account.tradable else ''}")
        return {"id": account.id}

    def remove(self, account_id):
        with self.lock:
            account = next((a for a in self.items if a.id == account_id), None)
            if account is None:
                raise ValueError(f"Không có tài khoản {account_id}")
            self.items.remove(account)
            self._persist()
        account.stop()
        print(f"[mt5] Đã gỡ {account.label}")
        return {"removed": account_id}

    def terminals(self):
        used = {str(a.cfg.get("terminal_path", "")).lower(): a.label for a in self.list()}
        return [{"path": p, "usedBy": used.get(p.lower())} for p in find_terminals()]


# ------------------------------------------------------------------------ Telegram

class Telegram:
    """Chạy Telethon trong một luồng riêng; tin nhắn giữ trong bộ nhớ."""

    def __init__(self, cfg):
        self.cfg = cfg or {}
        self.lock = threading.Lock()
        self.messages = []
        self.channels = []
        self.targets = {}
        self.loop = None
        self.tg = None
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

    async def resolve(self, client, names):
        """Chấp nhận @username, link t.me, id số, hoặc đúng tên hiển thị của kênh."""
        wanted = [str(c).strip() for c in names or [] if str(c).strip()]
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
        entities = await self.resolve(client, self.cfg.get("channels"))
        targets = await self.resolve(client, self.cfg.get("post_targets"))
        if not entities and not targets:
            print("[telegram] Chưa khai báo kênh nào; vẫn kết nối để gửi cảnh báo vào Saved Messages")
        titles = {e.id: get_display_name(e) for e in entities}
        limit = int(self.cfg.get("history_per_channel", 200))
        for e in entities:
            async for m in client.iter_messages(e, limit=limit):
                self.add(titles[e.id], m)

        if entities:
            @client.on(events.NewMessage(chats=entities))
            async def on_message(event):
                chat = await event.get_chat()
                self.add(titles.get(chat.id, get_display_name(chat)), event.message)

        self.channels = list(titles.values())
        self.targets = {get_display_name(e): e for e in targets}
        self.loop, self.tg = asyncio.get_running_loop(), client
        self.connected, self.error = True, ""
        print(f"[telegram] Đang nghe {len(entities)} kênh: {', '.join(self.channels)}")
        if self.targets:
            print(f"[telegram] Được phép gửi bài tới: {', '.join(self.targets)}")
        await client.run_until_disconnected()
        self.connected, self.error = False, "Mất kết nối Telegram"

    def send_me(self, text):
        """Nhắn vào Saved Messages của chính tài khoản Telegram: điện thoại sẽ báo. Không chặn, bỏ qua nếu chưa nối."""
        if not self.connected or self.loop is None:
            return
        client = self.tg
        asyncio.run_coroutine_threadsafe(client.send_message("me", text), self.loop)

    def send(self, target, text, image=None):
        """Gửi bài tới một nhóm trong post_targets. Chú thích ảnh của Telegram tối đa 1024 ký tự."""
        if not self.connected:
            raise RuntimeError(self.error or "Telegram chưa kết nối")
        if target not in self.targets:
            raise ValueError(f"'{target}' không nằm trong post_targets của config.json")
        entity, client = self.targets[target], self.tg

        async def go():
            if image:
                photo = io.BytesIO(image)
                photo.name = "fxdesk.png"
                short = len(text) <= 1024
                await client.send_file(entity, photo, caption=text if short else None)
                if not short:
                    await client.send_message(entity, text)
            else:
                await client.send_message(entity, text)

        asyncio.run_coroutine_threadsafe(go(), self.loop).result(90)
        print(f"[telegram] Đã gửi bài tới {target}")
        return {"sent": True, "target": target}

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


# ------------------------------------------------------------------- Lịch kinh tế

class Calendar:
    """Lịch kinh tế tuần này từ nguồn công khai của Forex Factory. Giữ lại 1 giờ vì nguồn giới hạn số lần gọi."""

    URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"

    def __init__(self):
        self.lock = threading.Lock()
        self.at = 0.0
        self.events = []

    def get(self):
        with self.lock:
            if self.events and time.time() - self.at < 3600:
                return self.events
            try:
                with urlopen(Request(self.URL, headers={"User-Agent": "fxdesk-bridge"}), timeout=15) as r:
                    raw = json.loads(r.read().decode("utf-8"))
                self.events = [{
                    "title": e.get("title", ""), "currency": e.get("country", ""), "date": e.get("date", ""),
                    "impact": e.get("impact", ""), "forecast": e.get("forecast", ""), "previous": e.get("previous", ""),
                } for e in raw]
                self.at = time.time()
            except Exception as e:
                if not self.events:
                    raise RuntimeError(f"Không tải được lịch kinh tế: {e}")
            return self.events


# ---------------------------------------------------------------------------- HTTP

def make_handler(registry, tg, kb, brain, calendar, auto, personas):

    def send_post(body):
        image = str(body.get("image") or "")
        data = base64.b64decode(image.split(",", 1)[-1]) if image else None
        text = str(body.get("text") or "").strip()
        if not text and not data:
            raise ValueError("Bài gửi đang trống")
        return tg.send(str(body["target"]), text, data)

    def pick(q):
        """Tài khoản theo ?account=...; không ghi thì lấy tài khoản đầu tiên (dùng cho nến và tỷ giá)."""
        if q.get("account"):
            account = registry.get(q["account"])
            if account is None:
                raise ValueError(f"Không có tài khoản {q['account']}")
            return account
        accounts = registry.list()
        if not accounts:
            raise RuntimeError("Chưa có tài khoản MT5 nào. Thêm ở trang Tài khoản MT5")
        return accounts[0]

    def snapshot(a):
        try:
            return {"id": a.id, "label": a.label, "type": a.type, "tradable": a.tradable, "connected": True, "error": "", **a.call("account")}
        except Exception as e:
            return {"id": a.id, "label": a.label, "type": a.type, "tradable": a.tradable, "connected": False, "error": str(e)}

    def parallel(fn):
        accounts = registry.list()
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
                "/status": lambda: {"accounts": parallel(lambda a: a.info()), "telegram": {"connected": tg.connected, "error": tg.error, "channels": tg.channels, "postTargets": list(tg.targets)}},
                "/accounts": lambda: parallel(snapshot),
                "/history": lambda: pick(q).call("history", int(q.get("days", 90))),
                "/candles": lambda: pick(q).call("candles", q["symbol"], q.get("tf", "H1"), int(q.get("count", 300))),
                "/prices": lambda: pick(q).call("prices", [s for s in q.get("symbols", "").split(",") if s]),
                "/telegram/messages": lambda: tg.since(int(q.get("after", 0))),
                "/calendar": calendar.get,
                "/terminals": registry.terminals,
                "/kb": kb.list,
                "/ai/status": brain.status,
                "/automation": auto.snapshot,
                "/personas": personas.list,
            }
            if url.path not in routes:
                return self.send(404, {"error": "Không có đường dẫn này"})
            self.answer(routes[url.path])

        def do_POST(self):
            # Tiêu đề riêng buộc trình duyệt hỏi trước (preflight), nên form trên trang web lạ không gửi lệnh được.
            if not self.local_only() or self.headers.get("X-FXDesk") != "1":
                return self.send(403, {"error": "Chỉ chấp nhận yêu cầu từ FX Desk trên chính máy này"})
            url = urlparse(self.path)
            size = int(self.headers.get("Content-Length") or 0)
            # Tài liệu PDF gửi lên có thể lớn; các yêu cầu khác giữ giới hạn nhỏ.
            if size > (40_000_000 if self.path.startswith("/kb/source") else 8_000_000):
                return self.send(400, {"error": "Dữ liệu gửi lên quá lớn"})
            try:
                body = json.loads(self.rfile.read(size) or b"{}")
            except ValueError:
                return self.send(400, {"error": "Dữ liệu gửi lên không phải JSON"})
            if url.path == "/order":
                def place():
                    lk = auto.locked(str(body["account"]))
                    if lk:
                        raise ValueError(f"Tài khoản đang bị khoá vào lệnh: {lk['reason']}")
                    return pick({"account": str(body["account"])}).call("order", body)
                self.answer(place)
            elif url.path == "/personas/save":
                self.answer(lambda: personas.save(body))
            elif url.path == "/personas/delete":
                self.answer(lambda: personas.delete(str(body["id"])))
            elif url.path == "/chat":
                self.answer(lambda: chat(brain, personas, body))
            elif url.path == "/chat/clear":
                self.answer(lambda: personas.clear(str(body["persona"])))
            elif url.path == "/automation/guard":
                self.answer(lambda: auto.set_guard(body))
            elif url.path == "/automation/unlock":
                self.answer(lambda: auto.unlock(str(body["account"])))
            elif url.path == "/automation/alerts":
                self.answer(lambda: auto.set_alerts(body))
            elif url.path == "/automation/copier":
                self.answer(lambda: auto.set_copier(body))
            elif url.path == "/automation/test":
                self.answer(auto.test_notify)
            elif url.path == "/kb/save":
                self.answer(lambda: kb.save(body))
            elif url.path == "/kb/delete":
                self.answer(lambda: kb.delete(str(body["id"])))
            elif url.path == "/kb/source":
                self.answer(lambda: kb.add_source(body))
            elif url.path == "/kb/source/delete":
                self.answer(lambda: kb.remove_source(str(body["playbook"]), str(body["source"])))
            elif url.path == "/kb/learn":
                self.answer(lambda: brain.learn(body))
            elif url.path == "/ai/analyze":
                self.answer(lambda: brain.analyze(body))
            elif url.path == "/accounts/add":
                self.answer(lambda: registry.add(body))
            elif url.path == "/accounts/remove":
                self.answer(lambda: registry.remove(str(body["account"])))
            elif url.path == "/telegram/send":
                self.answer(lambda: send_post(body))
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
    registry = Registry(cfg)
    kb = Knowledge()
    brain = Brain(cfg, kb)
    personas = Personas(kb)
    calendar = Calendar()
    auto = Automation(registry, tg, calendar)
    auto.start()
    ai = brain.status()
    print(f"[ai] {ai['providerName']} · model {ai['model'] or '(chưa chọn)'}" + ("" if ai["configured"] else f" — {ai['problem']}"))
    for a in registry.list():
        print(f"[mt5] {a.label} ({a.type}){' — CHO PHÉP VÀO LỆNH' if a.tradable else ''}: đang kết nối…")
    tg.start()
    port = int(cfg.get("port", 8787))
    server = ThreadingHTTPServer(("127.0.0.1", port), make_handler(registry, tg, kb, brain, calendar, auto, personas))
    print(f"FX Desk bridge đang chạy tại http://127.0.0.1:{port} (Ctrl+C để dừng)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
