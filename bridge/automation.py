"""
Tự động hoá chạy nền trong bridge, không cần mở app:

- Bảo vệ tài khoản (Guardian): theo dõi lỗ trong ngày (lệnh đã chốt + lệnh đang treo) và khoảng cách tới sàn lỗ tổng.
  Cảnh báo ở các ngưỡng, và khi chạm ngưỡng hành động thì đóng hết lệnh, khoá vào lệnh tới hết ngày máy chủ.
  Cũng khoá khi thua liên tiếp đủ N lệnh hoặc vào quá số lệnh tối đa trong ngày.
- Cảnh báo tin: nhắn Telegram trước tin mạnh của đồng tiền đang có lệnh mở.
- Copy lệnh: chép lệnh từ một tài khoản nguồn sang các tài khoản nhận (mở, đóng, SL/TP).

Đóng lệnh, khoá và copy cần tài khoản bật "allow_trading" (mật khẩu giao dịch). Tài khoản chỉ có mật khẩu view thì
chỉ nhận cảnh báo. Cấu hình lưu ở bridge/automation.json, chỉnh từ trang Bảo vệ và Copy lệnh trong app.
"""
import json
import os
import threading
import time
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
STATE_FILE = HERE / "automation.json"
TAG = "FXD#"


def now():
    return time.time()


class Automation:
    def __init__(self, registry, tg, calendar):
        self.registry, self.tg, self.calendar = registry, tg, calendar
        self.lock = threading.RLock()
        self.events = []
        self.states = {}
        self.copy_state = {"ignored": [], "fails": {}, "started": 0, "last": 0, "error": ""}
        self.notified_news = set()
        self.today_cache = {}
        data = {}
        if STATE_FILE.exists():
            try:
                data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
            except ValueError:
                data = {}
        self.guards = data.get("guards", {})
        self.locks = data.get("locks", {})
        self.alerts = {"news": True, "minutes": 30, "notify": True, **data.get("alerts", {})}
        self.copier = data.get("copier", {"enabled": False, "master": "", "followers": [], "copy_sltp": True})

    # ------------------------------------------------------------ lưu trạng thái
    def _save(self):
        tmp = STATE_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps({"guards": self.guards, "locks": self.locks, "alerts": self.alerts, "copier": self.copier}, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, STATE_FILE)

    def event(self, kind, account, text, notify=True):
        label = self._label(account)
        e = {"at": int(now() * 1000), "kind": kind, "account": account, "label": label, "text": text}
        with self.lock:
            self.events.append(e)
            del self.events[:-200]
        print(f"[{kind}] {label}: {text}")
        if notify and self.alerts.get("notify", True):
            self.tg.send_me(f"FX Desk · {label}\n{text}")

    def _label(self, account_id):
        a = self.registry.get(account_id) if account_id else None
        return a.label if a else (account_id or "Hệ thống")

    # ---------------------------------------------------------------- API
    def snapshot(self):
        with self.lock:
            return {
                "guards": self.guards, "states": self.states, "locks": self.locks, "events": list(reversed(self.events[-100:])),
                "alerts": self.alerts, "copier": self.copier,
                "copyState": {"started": self.copy_state["started"], "last": self.copy_state["last"], "error": self.copy_state["error"]},
                "telegram": bool(self.tg.connected),
            }

    def set_guard(self, body):
        account = str(body.get("account"))
        if not self.registry.get(account):
            raise ValueError(f"Không có tài khoản {account}")
        cfg = body.get("config")
        with self.lock:
            if not cfg:
                self.guards.pop(account, None)
            else:
                num = lambda k, d=0.0: max(0.0, float(cfg.get(k) or d))
                self.guards[account] = {
                    "enabled": bool(cfg.get("enabled", True)),
                    "daily_limit": num("daily_limit"), "floor": num("floor"), "max_loss": num("max_loss"),
                    "warn_at": sorted({min(0.99, max(0.1, float(x))) for x in (cfg.get("warn_at") or [0.7, 0.9])}),
                    "act_at": min(1.0, max(0.5, float(cfg.get("act_at") or 0.95))),
                    "max_consec_losses": int(cfg.get("max_consec_losses") or 0), "max_trades": int(cfg.get("max_trades") or 0),
                    "close_on_breach": bool(cfg.get("close_on_breach", True)), "close_new_when_locked": bool(cfg.get("close_new_when_locked", True)),
                    "server_offset": float(cfg.get("server_offset") or 0),
                }
            self._save()
        return self.snapshot()

    def unlock(self, account):
        with self.lock:
            self.locks.pop(str(account), None)
            self._save()
        self.event("unlock", str(account), "Đã mở khoá bằng tay.", notify=True)
        return self.snapshot()

    def set_alerts(self, body):
        with self.lock:
            self.alerts = {"news": bool(body.get("news", True)), "minutes": max(5, min(240, int(body.get("minutes") or 30))), "notify": bool(body.get("notify", True))}
            self._save()
        return self.snapshot()

    def set_copier(self, body):
        cfg = body.get("config") or {}
        followers = []
        for f in cfg.get("followers") or []:
            if not self.registry.get(str(f.get("account"))):
                raise ValueError(f"Không có tài khoản {f.get('account')}")
            mode = f.get("mode") if f.get("mode") in ("fixed", "multiplier", "balance") else "multiplier"
            followers.append({"account": str(f["account"]), "mode": mode, "value": max(0.0, float(f.get("value") or 1)), "reverse": bool(f.get("reverse"))})
        master = str(cfg.get("master") or "")
        if master and any(f["account"] == master for f in followers):
            raise ValueError("Tài khoản nguồn không thể đồng thời là tài khoản nhận")
        with self.lock:
            was = self.copier.get("enabled")
            self.copier = {"enabled": bool(cfg.get("enabled")) and bool(master) and bool(followers), "master": master, "followers": followers, "copy_sltp": bool(cfg.get("copy_sltp", True))}
            if self.copier["enabled"] and not was:
                self._start_copy()
            self._save()
        return self.snapshot()

    def test_notify(self):
        if not self.tg.connected:
            raise RuntimeError("Telegram chưa kết nối")
        self.tg.send_me("FX Desk: tin nhắn thử. Cảnh báo bảo vệ tài khoản và tin mạnh sẽ được gửi vào đây.")
        return {"sent": True}

    def locked(self, account):
        lk = self.locks.get(str(account))
        return lk if lk and lk.get("until", 0) > now() else None

    # ------------------------------------------------------------- vòng lặp
    def start(self):
        for target, period in ((self._guard_tick, 3), (self._news_tick, 60), (self._copy_tick, 1.5)):
            threading.Thread(target=self._loop, args=(target, period), daemon=True).start()

    def _loop(self, fn, period):
        while True:
            try:
                fn()
            except Exception:
                traceback.print_exc()
            time.sleep(period)

    # ------------------------------------------------------- bảo vệ tài khoản
    def _today(self, acc, off):
        """Kết quả hôm nay, lấy lại tối đa 10 giây một lần để đỡ tải MT5."""
        c = self.today_cache.get(acc.id)
        if c and now() - c[0] < 10:
            return c[1]
        t = acc.call("today", off, timeout=20)
        self.today_cache[acc.id] = (now(), t)
        return t

    def _guard_tick(self):
        with self.lock:
            guards = dict(self.guards)
            expired = [k for k, v in self.locks.items() if v.get("until", 0) <= now()]
            for k in expired:
                self.locks.pop(k)
            if expired:
                self._save()
        for account_id, g in guards.items():
            acc = self.registry.get(account_id)
            if not acc or not g.get("enabled"):
                continue
            try:
                self._guard_one(acc, g)
            except Exception as e:
                self.states[account_id] = {**self.states.get(account_id, {}), "error": str(e), "updated": int(now() * 1000)}

    def _guard_one(self, acc, g):
        live = acc.call("account", timeout=20)
        today = self._today(acc, g["server_offset"])
        day_loss = max(0.0, -(today["closed_pnl"] + live["profit"]))
        used = day_loss / g["daily_limit"] if g["daily_limit"] > 0 else 0.0
        floor_used = 0.0
        if g["floor"] > 0 and g["max_loss"] > 0:
            floor_used = max(0.0, (g["max_loss"] - (live["equity"] - g["floor"])) / g["max_loss"])
        level = max(used, floor_used)
        day = today["day_start"]
        st = self.states.get(acc.id, {})
        warned = st.get("warned", []) if st.get("day") == day else []
        next_day = day + 86400 - g["server_offset"] * 3600  # giờ máy chủ → epoch thật

        for th in g["warn_at"]:
            if level >= th and th not in warned:
                warned.append(th)
                what = "lỗ trong ngày" if used >= floor_used else "lỗ tổng"
                self.event("warn", acc.id, f"Đã dùng {level * 100:.0f}% giới hạn {what}. Lỗ hôm nay {day_loss:.2f} {live['currency']}, equity {live['equity']:.2f}.")

        reason = ""
        if level >= g["act_at"]:
            reason = f"Chạm {level * 100:.0f}% giới hạn {'lỗ trong ngày' if used >= floor_used else 'lỗ tổng'}"
        elif g["max_consec_losses"] and today["consec_losses"] >= g["max_consec_losses"]:
            reason = f"Thua liên tiếp {today['consec_losses']} lệnh"
        elif g["max_trades"] and today["trades"] >= g["max_trades"]:
            reason = f"Đã vào {today['trades']} lệnh hôm nay (tối đa {g['max_trades']})"

        lock = self.locked(acc.id)
        if reason and not lock:
            with self.lock:
                self.locks[acc.id] = {"until": next_day, "reason": reason, "at": now()}
                self._save()
            lock = self.locks[acc.id]
            closed = ""
            if level >= g["act_at"] and g["close_on_breach"] and live["positions"]:
                if acc.tradable:
                    r = acc.call("close_all", timeout=60)
                    closed = f" Đã đóng {r['closed']} lệnh." + (f" Lỗi: {'; '.join(r['errors'])}" if r["errors"] else "")
                else:
                    closed = " Không đóng được lệnh vì tài khoản chỉ có mật khẩu view: hãy tự đóng ngay."
            self.event("lock", acc.id, f"{reason}. Khoá vào lệnh tới hết ngày máy chủ.{closed}")
        elif lock and g["close_new_when_locked"] and acc.tradable:
            fresh = [p for p in live["positions"] if p["time"] - g["server_offset"] * 3600 > lock["at"]]
            if fresh:
                r = acc.call("close_all", timeout=60)
                self.event("lock", acc.id, f"Đang khoá ({lock['reason']}) nhưng có {len(fresh)} lệnh mới mở. Đã đóng {r['closed']} lệnh.")

        self.states[acc.id] = {
            "day": day, "warned": warned, "day_loss": round(day_loss, 2), "used": round(used, 4), "floor_used": round(floor_used, 4),
            "level": round(level, 4), "equity": live["equity"], "currency": live["currency"], "consec_losses": today["consec_losses"],
            "trades": today["trades"], "positions": len(live["positions"]), "tradable": acc.tradable, "error": "", "updated": int(now() * 1000),
        }

    # ------------------------------------------------------------ cảnh báo tin
    def _news_tick(self):
        if not self.alerts.get("news"):
            return
        currencies = set()
        for acc in self.registry.list():
            try:
                for p in acc.call("account", timeout=20)["positions"]:
                    sym = "".join(c for c in p["symbol"].upper() if c.isalpha())[:6]
                    currencies.update({sym[:3], sym[3:6]} - {"XAU", "XAG"})
            except Exception:
                continue
        if not currencies:
            return
        try:
            events = self.calendar.get()
        except Exception:
            return
        from datetime import datetime
        horizon = self.alerts.get("minutes", 30) * 60
        for e in events:
            if e.get("impact") != "High" or e.get("currency") not in currencies:
                continue
            try:
                t = datetime.fromisoformat(e["date"]).timestamp()
            except (ValueError, KeyError):
                continue
            key = f"{e['currency']}|{e['title']}|{e['date']}"
            if 0 <= t - now() <= horizon and key not in self.notified_news:
                self.notified_news.add(key)
                mins = int((t - now()) // 60)
                self.event("news", "", f"Còn {mins} phút nữa có tin mạnh {e['currency']}: {e['title']}. Bạn đang có lệnh mở với {e['currency']}.")

    # --------------------------------------------------------------- copy lệnh
    def _start_copy(self):
        """Chỉ chép lệnh mở sau thời điểm bật, bỏ qua các lệnh nguồn đang có."""
        master = self.registry.get(self.copier.get("master", ""))
        ignored = []
        if master:
            try:
                ignored = [p["ticket"] for p in master.call("account", timeout=20)["positions"]]
            except Exception:
                pass
        self.copy_state = {"ignored": ignored, "fails": {}, "started": int(now() * 1000), "last": 0, "error": ""}
        self.event("copy", self.copier.get("master", ""), f"Bật copy lệnh sang {len(self.copier.get('followers', []))} tài khoản. Bỏ qua {len(ignored)} lệnh đang mở sẵn.", notify=False)

    @staticmethod
    def copy_volume(master_vol, master_balance, follower_balance, mode, value):
        if mode == "fixed":
            return value
        if mode == "balance":
            return master_vol * (follower_balance / master_balance if master_balance > 0 else 0) * value
        return master_vol * value

    def _copy_tick(self):
        cfg = self.copier
        if not cfg.get("enabled"):
            return
        master = self.registry.get(cfg["master"])
        if not master:
            self.copy_state["error"] = "Không thấy tài khoản nguồn"
            return
        m = master.call("account", timeout=20)
        mpos = {p["ticket"]: p for p in m["positions"]}
        ignored = set(self.copy_state["ignored"])
        for f in cfg["followers"]:
            acc = self.registry.get(f["account"])
            if not acc:
                continue
            if not acc.tradable:
                self.copy_state["error"] = f"{acc.label} chưa bật cho phép vào lệnh"
                continue
            if self.locked(acc.id):
                continue  # đang bị Bảo vệ khoá: không chép lệnh mới vào
            live = acc.call("account", timeout=20)
            linked = {}
            for p in live["positions"]:
                c = str(p.get("comment", ""))
                if c.startswith(TAG) and c[len(TAG):].isdigit():
                    linked[int(c[len(TAG):])] = p
            # mở lệnh mới
            for mt, mp in mpos.items():
                if mt in ignored or mt in linked:
                    continue
                key = f"{mt}:{acc.id}"
                if self.copy_state["fails"].get(key, 0) >= 3:
                    continue
                side = mp["side"] if not f["reverse"] else ("sell" if mp["side"] == "buy" else "buy")
                sl, tp = (mp["sl"], mp["tp"]) if not f["reverse"] else (mp["tp"], mp["sl"])
                vol = self.copy_volume(mp["volume"], m["balance"], live["balance"], f["mode"], f["value"])
                try:
                    r = acc.call("copy_open", {"symbol": mp["symbol"], "side": side, "volume": vol, "sl": sl if cfg.get("copy_sltp") else 0, "tp": tp if cfg.get("copy_sltp") else 0, "comment": f"{TAG}{mt}"}, timeout=30)
                    self.event("copy", acc.id, f"Chép {side.upper()} {r['volume']} lot {mp['symbol']} từ lệnh #{mt}.", notify=False)
                except Exception as e:
                    self.copy_state["fails"][key] = self.copy_state["fails"].get(key, 0) + 1
                    if self.copy_state["fails"][key] == 3:
                        self.event("copy-error", acc.id, f"Không chép được lệnh #{mt} {mp['symbol']} sau 3 lần: {e}")
            # đóng lệnh khi lệnh nguồn đã đóng
            for mt, fp in linked.items():
                if mt not in mpos:
                    try:
                        acc.call("close", fp["ticket"], timeout=30)
                        self.event("copy", acc.id, f"Đóng {fp['symbol']} #{fp['ticket']} theo lệnh nguồn #{mt}.", notify=False)
                    except Exception as e:
                        self.event("copy-error", acc.id, f"Không đóng được #{fp['ticket']}: {e}")
                elif cfg.get("copy_sltp") and not f["reverse"]:
                    mp = mpos[mt]
                    if abs(fp["sl"] - mp["sl"]) > 1e-9 or abs(fp["tp"] - mp["tp"]) > 1e-9:
                        try:
                            acc.call("modify", fp["ticket"], mp["sl"], mp["tp"], timeout=30)
                        except Exception as e:
                            self.copy_state["error"] = f"Sửa SL/TP #{fp['ticket']}: {e}"
        self.copy_state["last"] = int(now() * 1000)
