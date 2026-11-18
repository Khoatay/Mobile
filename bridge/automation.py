"""
Tự động hoá chạy nền trong bridge, không cần mở app:

- Bảo vệ tài khoản (Guardian): theo dõi lỗ trong ngày (so với mốc đầu ngày) và khoảng cách tới sàn lỗ tổng.
  Cảnh báo ở các ngưỡng, và khi chạm ngưỡng hành động thì đóng hết lệnh, khoá vào lệnh tới hết ngày máy chủ.
  Cũng khoá khi thua liên tiếp đủ N lệnh hoặc vào quá số lệnh tối đa trong ngày.
  SL khẩn cấp: gắn/siết SL trên máy chủ sàn để dù máy tắt hay giá chạy nhanh, tổng lỗ nếu mọi lệnh chạm SL vẫn trong giới hạn.
  Khoá cứng: khoá vì chạm giới hạn lỗ thì không mở được tới hết ngày; khoá vì hành vi (thua liên tiếp, quá số lệnh) phải chờ 30 phút.
  Mốc đầu ngày: số dư đầu ngày, hoặc số cao hơn giữa số dư và equity đầu ngày (kiểu The5ers).
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

from paths import DATA
STATE_FILE = DATA / "automation.json"
NEWS_WATCH_DEFAULT = {"enabled": True, "events": [], "currencies": [], "impact": "High", "lead_min": 15, "repeat_min": 0, "telegram": True}
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
        self.last_seen = {}
        self.stop_runs = {}
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
        self.day_refs = data.get("day_refs", {})
        # Luật trong ngày của từng tài khoản: đã đặt giới hạn hôm nay chưa, đã có lệnh chưa (từ đó không nới được), đã "trade tiếp" sau chốt lời chưa.
        self.day_rules = data.get("day_rules", {})
        # Cảnh báo tin kiểu Investing: tin được đánh dấu, hoặc mọi tin từ một mức độ của các đồng tiền đã chọn.
        self.news_watch = {**NEWS_WATCH_DEFAULT, **data.get("news_watch", {})}
        self.news_acks = set(data.get("news_acks", []))  # tin người dùng đã bấm "Tắt"
        self.news_active = {}  # tin đang nhắc: key -> lần gửi gần nhất, số lần, thông tin tin
        self.bot = None  # bot Telegram nối ở trang Hồ sơ (gắn từ bridge.py)

    # ------------------------------------------------------------ lưu trạng thái
    def _save(self):
        tmp = STATE_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps({"guards": self.guards, "locks": self.locks, "alerts": self.alerts, "copier": self.copier, "day_refs": self.day_refs, "day_rules": self.day_rules, "news_watch": self.news_watch, "news_acks": sorted(self.news_acks)[-500:]}, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, STATE_FILE)

    def event(self, kind, account, text, notify=True):
        label = self._label(account)
        e = {"at": int(now() * 1000), "kind": kind, "account": account, "label": label, "text": text}
        with self.lock:
            self.events.append(e)
            del self.events[:-200]
        print(f"[{kind}] {label}: {text}")
        if notify and self.alerts.get("notify", True):
            self.notify(f"{label}\n{text}")

    def _label(self, account_id):
        a = self.registry.get(account_id) if account_id else None
        return a.label if a else (account_id or "Hệ thống")

    # ---------------------------------------------------------------- API
    def snapshot(self):
        with self.lock:
            return {
                "guards": self.guards, "states": self.states, "locks": self.locks, "rules": self.day_rules, "events": list(reversed(self.events[-100:])),
                "alerts": self.alerts, "copier": self.copier,
                "copyState": {"started": self.copy_state["started"], "last": self.copy_state["last"], "error": self.copy_state["error"]},
                "telegram": self.telegram_ready(),
            }

    # Trường nào "nới" khi đổi từ cũ sang mới (nới = rủi ro hơn). Sau lệnh đầu tiên trong ngày chỉ siết được, không nới.
    LOOSER = {
        "enabled": lambda o, n: bool(o) and not n,
        "daily_limit": lambda o, n: (o > 0 and n <= 0) or n > o + 0.009,
        "profit_limit": lambda o, n: (o > 0 and n <= 0) or n > o + 0.009,
        "floor": lambda o, n: n < o - 0.009,
        "max_loss": lambda o, n: (o > 0 and n <= 0) or n > o + 0.009,
        "act_at": lambda o, n: n > o + 1e-9,
        "max_consec_losses": lambda o, n: (o > 0 and n <= 0) or n > o,
        "max_trades": lambda o, n: (o > 0 and n <= 0) or n > o,
        "close_on_breach": lambda o, n: bool(o) and not n,
        "close_new_when_locked": lambda o, n: bool(o) and not n,
        "hard_stop": lambda o, n: bool(o) and not n,
        "hard_lock": lambda o, n: bool(o) and not n,
    }
    NAMES = {"enabled": "tắt bảo vệ", "daily_limit": "giới hạn lỗ ngày", "profit_limit": "mục tiêu lãi ngày", "floor": "sàn lỗ tổng", "max_loss": "lỗ tổng",
             "act_at": "mức hành động", "max_consec_losses": "số lệnh thua liên tiếp", "max_trades": "số lệnh tối đa", "close_on_breach": "đóng lệnh khi chạm",
             "close_new_when_locked": "tự đóng lệnh mới khi khoá", "hard_stop": "SL khẩn cấp", "hard_lock": "khoá cứng"}

    def server_day(self, offset):
        return int((now() + float(offset) * 3600) // 86400 * 86400)

    def rule(self, account, day):
        """Luật của hôm nay; sang ngày mới thì làm lại từ đầu (giới hạn giữ nguyên số của hôm trước)."""
        r = self.day_rules.get(account)
        if not r or r.get("day") != day:
            r = {"day": day, "set_loss": False, "set_profit": False, "active": False, "active_at": 0, "continued": False, "protect": None, "continued_from": 0}
            self.day_rules[account] = r
        return r

    def _check_change(self, account, old, new, auto):
        """Áp luật trong ngày lên cấu hình mới. Trả về cấu hình được phép lưu, hoặc báo lỗi rõ lý do.
        - Trước lệnh đầu tiên trong ngày: đặt giới hạn lỗ và mục tiêu lãi được MỘT lần (mỗi thứ), sau đó chỉ siết được.
        - Từ lệnh đầu tiên trong ngày (hoặc khi còn lệnh mở từ hôm trước): mọi thứ chỉ siết được, không nới, không tắt.
        - Không đặt gì thì dùng số của hôm trước.
        auto=True (app tự gửi lại khi số dư đổi): phần nới bị bỏ qua lặng lẽ, giữ số cũ."""
        if not old or not old.get("enabled"):
            return new  # bật mới: chưa có luật nào để giữ
        r = self.rule(account, self.server_day(old.get("server_offset", 0)))
        out = dict(new)
        for k, looser in self.LOOSER.items():
            if k not in old or k not in new or not looser(old[k], new[k]):
                continue
            once = k in ("daily_limit", "profit_limit") and not r["active"] and not r["set_loss" if k == "daily_limit" else "set_profit"]
            if once:
                continue  # lần đặt duy nhất trong ngày, trước lệnh đầu tiên
            if auto:
                out[k] = old[k]
                continue
            if k == "enabled":
                raise ValueError("Hôm nay đã có lệnh: không tắt được bảo vệ. Ngày mai trước lệnh đầu tiên bạn tắt được.")
            if r["active"]:
                raise ValueError(f"Hôm nay đã có lệnh: không nới được {self.NAMES[k]}, chỉ siết chặt hơn. Ngày mai, trước lệnh đầu tiên, bạn đổi lại được.")
            raise ValueError(f"Hôm nay bạn đã đặt {self.NAMES[k]} một lần: không nới thêm được, chỉ siết chặt hơn. Ngày mai trước lệnh đầu tiên đổi lại được.")
        if not r["active"] and not auto:
            if abs(out.get("daily_limit", 0) - old.get("daily_limit", 0)) > 0.009:
                r["set_loss"] = True
            if abs(out.get("profit_limit", 0) - old.get("profit_limit", 0)) > 0.009:
                r["set_profit"] = True
        return out

    def continue_after_profit(self, body):
        """Đạt mục tiêu lãi rồi vẫn muốn trade tiếp: một lần mỗi ngày, chọn số tiền được phép trả lại (không quá số đã lãi).
        Lãi trong ngày tụt về (lãi lúc này − số đó) thì đóng hết lệnh và khoá cứng tới hết ngày, không có lựa chọn nào nữa."""
        account = str(body.get("account"))
        with self.lock:
            lk = self.locks.get(account)
            g = self.guards.get(account)
            st = self.states.get(account, {})
            if not lk or lk.get("kind") != "profit" or not g:
                raise ValueError("Tài khoản không ở trạng thái khoá vì đạt mục tiêu lãi")
            r = self.rule(account, self.server_day(g.get("server_offset", 0)))
            if r["continued"]:
                raise ValueError("Hôm nay bạn đã dùng lượt trade tiếp sau khi chốt lời rồi")
            profit = float(st.get("day_profit") or 0)
            giveback = float(body.get("giveback") or 0)
            if profit <= 0:
                raise ValueError("Chưa thấy lãi hôm nay, không có gì để giữ")
            if giveback <= 0 or giveback > profit + 0.009:
                raise ValueError(f"Số tiền được trả lại phải lớn hơn 0 và không quá số đã lãi ({profit:.2f})")
            r.update(continued=True, protect=round(profit - giveback, 2), continued_from=round(profit, 2))
            self.locks.pop(account, None)
            self._save()
        self.event("unlock", account, f"Trade tiếp sau khi đạt mục tiêu lãi (+{profit:.2f}). Được trả lại tối đa {giveback:.2f}: lãi trong ngày tụt về {profit - giveback:.2f} thì đóng hết lệnh và khoá cứng tới hết ngày.")
        return self.snapshot()

    def set_guard(self, body):
        account = str(body.get("account"))
        if not self.registry.get(account):
            raise ValueError(f"Không có tài khoản {account}")
        cfg = body.get("config")
        auto = bool(body.get("auto"))
        with self.lock:
            old_cfg = self.guards.get(account)
            if not cfg and old_cfg and old_cfg.get("enabled"):
                r = self.rule(account, self.server_day(old_cfg.get("server_offset", 0)))
                if r["active"]:
                    raise ValueError("Hôm nay đã có lệnh: không tắt được bảo vệ. Ngày mai trước lệnh đầu tiên bạn tắt được.")
            lk = self.locked(account)
            if lk and lk.get("unlock_at", 0) > now():
                old = self.guards.get(account, {})
                if not cfg or not cfg.get("enabled", True):
                    raise ValueError("Đang khoá cứng: không tắt được bảo vệ cho tới khi hết khoá.")
                if old.get("hard_lock") and (not cfg.get("hard_lock", True) or not cfg.get("close_new_when_locked", True)):
                    raise ValueError("Đang khoá cứng: không đổi được cài đặt khoá cho tới khi hết khoá.")
            if not cfg:
                self.guards.pop(account, None)
            else:
                num = lambda k, d=0.0: max(0.0, float(cfg.get(k) or d))
                new = {
                    "enabled": bool(cfg.get("enabled", True)),
                    "daily_limit": num("daily_limit"), "floor": num("floor"), "max_loss": num("max_loss"),
                    # Chốt lãi trong ngày: lãi (đã chốt + đang treo) chạm mức này thì đóng hết lệnh và khoá tới hết ngày. 0 = tắt.
                    "profit_limit": num("profit_limit"),
                    "warn_at": sorted({min(0.99, max(0.1, float(x))) for x in (cfg.get("warn_at") or [0.7, 0.9])}),
                    "act_at": min(1.0, max(0.5, float(cfg.get("act_at") or 0.95))),
                    "max_consec_losses": int(cfg.get("max_consec_losses") or 0), "max_trades": int(cfg.get("max_trades") or 0),
                    "close_on_breach": bool(cfg.get("close_on_breach", True)), "close_new_when_locked": bool(cfg.get("close_new_when_locked", True)),
                    "server_offset": float(cfg.get("server_offset") or 0),
                    "hard_stop": bool(cfg.get("hard_stop", True)), "hard_lock": bool(cfg.get("hard_lock", True)),
                    "day_ref": "higher" if cfg.get("day_ref") == "higher" else "balance",
                }
                self.guards[account] = self._check_change(account, old_cfg, new, auto)  # báo lỗi thì giữ nguyên cấu hình cũ
            self._save()
        return self.snapshot()

    def unlock(self, account):
        with self.lock:
            lk = self.locks.get(str(account))
            if lk and lk.get("unlock_at", 0) > now():
                if lk.get("kind") == "profit":
                    raise ValueError("Đạt mục tiêu lãi: muốn trade tiếp thì dùng nút Trade tiếp (một lần mỗi ngày, chọn số tiền được trả lại).")
                if lk.get("unlock_at", 0) >= lk.get("until", 0):
                    raise ValueError("Khoá vì chạm giới hạn: tự mở lúc hết ngày máy chủ, không mở tay được.")
                mins = int((lk["unlock_at"] - now()) // 60) + 1
                raise ValueError(f"Khoá cứng: còn {mins} phút nữa mới mở khoá được. Đi uống nước đã.")
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

    # ------------------------------------------------------------ cảnh báo tin
    def news_snapshot(self):
        with self.lock:
            active = [{"key": k, **v} for k, v in self.news_active.items() if k not in self.news_acks]
            return {"config": self.news_watch, "active": sorted(active, key=lambda x: x["at"]), "acks": sorted(self.news_acks)[-200:], "telegram": self.telegram_ready()}

    def set_news_watch(self, body):
        cfg = body.get("config") or {}
        impact = cfg.get("impact") if cfg.get("impact") in ("High", "Medium", "Low") else "High"
        with self.lock:
            self.news_watch = {
                "enabled": bool(cfg.get("enabled", True)),
                "events": [str(x) for x in (cfg.get("events") or [])][-300:],
                "currencies": [str(c).upper()[:3] for c in (cfg.get("currencies") or [])],
                "impact": impact,
                "lead_min": max(1, min(240, int(cfg.get("lead_min") or 15))),
                "repeat_min": max(0, min(30, int(cfg.get("repeat_min") or 0))),
                "telegram": bool(cfg.get("telegram", True)),
            }
            self._save()
        return self.news_snapshot()

    def ack_news(self, body):
        """Bấm "Tắt" trong app: dừng nhắc một tin (key) hoặc mọi tin đang nhắc (all)."""
        with self.lock:
            keys = list(self.news_active) if body.get("all") else [str(body.get("key") or "")]
            for k in keys:
                if k:
                    self.news_acks.add(k)
                    self.news_active.pop(k, None)
            self._save()
        return self.news_snapshot()

    def _news_watch_tick(self):
        cfg = self.news_watch
        if not cfg.get("enabled"):
            return
        try:
            events = self.calendar.get()
        except Exception:
            return
        from datetime import datetime
        rank = {"High": 3, "Medium": 2, "Low": 1}
        lead, rep = cfg["lead_min"] * 60, cfg["repeat_min"] * 60
        for e in events:
            key = f"{e.get('currency')}|{e.get('title')}|{e.get('date')}"
            by_rule = e.get("currency") in cfg["currencies"] and rank.get(e.get("impact"), 0) >= rank[cfg["impact"]]
            if not (key in cfg["events"] or by_rule) or key in self.news_acks:
                continue
            try:
                t = datetime.fromisoformat(e["date"]).timestamp()
            except (ValueError, KeyError):
                continue
            left = t - now()
            if left < 0:
                self.news_active.pop(key, None)  # tin đã ra: thôi nhắc
                continue
            if left > lead:
                continue
            st = self.news_active.get(key)
            if st is None or (rep > 0 and now() - st["last"] >= rep):
                count = (st or {}).get("count", 0) + 1
                self.news_active[key] = {"last": now(), "count": count, "at": int(t * 1000), "title": e.get("title", ""), "currency": e.get("currency", ""), "impact": e.get("impact", "")}
                hhmm = datetime.fromtimestamp(t).strftime("%H:%M")
                text = f"🔔 {e.get('currency')} · {e.get('title')} lúc {hhmm} (còn {int(left // 60)} phút)" + (f" · nhắc lần {count}" if count > 1 else "")
                if rep > 0:
                    text += f". Nhắc lại mỗi {cfg['repeat_min']} phút tới khi bấm Tắt trong app."
                self.event("news", "", text, notify=False)
                if cfg.get("telegram", True):
                    self.notify(text)

    def telegram_ready(self):
        return bool((self.bot and self.bot.chat_id is not None) or self.tg.connected)

    def notify(self, text):
        """Gửi cảnh báo về điện thoại: qua bot đã nối ở trang Hồ sơ; chưa có bot thì vào Saved Messages của tài khoản Telegram đã đăng nhập."""
        if self.bot and self.bot.send(f"Golden Duck · {text}"):
            return
        try:
            self.tg.send_me(f"Golden Duck · {text}")
        except Exception as ex:
            print(f"[telegram] Không gửi được: {ex}")

    def stop_all_news(self):
        """Người dùng gõ "tắt" trong Telegram: dừng mọi cảnh báo tin đang nhắc. Trả về số tin đã tắt."""
        n = len([k for k in self.news_active if k not in self.news_acks])
        self.ack_news({"all": True})
        return n

    def test_notify(self):
        if self.bot and self.bot.chat_id is not None:
            return self.bot.test()
        if not self.tg.connected:
            raise RuntimeError("Telegram chưa kết nối. Nối bot ở trang Hồ sơ")
        self.tg.send_me("Golden Duck: tin nhắn thử. Cảnh báo bảo vệ tài khoản và tin mạnh sẽ được gửi vào đây.")
        return {"sent": True}

    def locked(self, account):
        lk = self.locks.get(str(account))
        return lk if lk and lk.get("until", 0) > now() else None

    # ------------------------------------------------------------- vòng lặp
    def start(self):
        for target, period in ((self._guard_tick, 3), (self._news_tick, 60), (self._news_watch_tick, 20), (self._copy_tick, 1.5)):
            threading.Thread(target=self._loop, args=(target, period), daemon=True).start()

    def _loop(self, fn, period):
        while True:
            try:
                fn()
            except Exception:
                traceback.print_exc()
            time.sleep(period)

    # ------------------------------------------------------- bảo vệ tài khoản
    def _today(self, acc, off, sig):
        """Kết quả hôm nay, lấy lại tối đa 10 giây một lần để đỡ tải MT5, nhưng lấy ngay khi danh sách lệnh mở đổi
        (có lệnh vừa đóng: lỗ chuyển từ đang treo sang đã chốt, không được để lọt khỏi phép tính)."""
        c = self.today_cache.get(acc.id)
        if c and now() - c[0] < 10 and c[2] == sig:
            return c[1]
        t = acc.call("today", off, timeout=20)
        self.today_cache[acc.id] = (now(), t, sig)
        return t

    def _day_ref(self, acc, g, live, today):
        """Mốc đầu ngày. Số dư đầu ngày luôn tính được (số dư − lãi/lỗ đã chốt hôm nay). Equity đầu ngày chỉ biết
        nếu bridge đang chạy quanh 0h giờ máy chủ: lấy lần đo cuối của hôm trước (trong 2 phút trước 0h) hoặc lần đo đầu của
        hôm nay (trong 2 phút sau 0h). Không có thì dùng số dư đầu ngày và báo cho người dùng."""
        day = today["day_start"]
        start_real = day - g["server_offset"] * 3600
        bal0 = live["balance"] - today["closed_pnl"]
        ref = self.day_refs.get(acc.id)
        if not ref or ref.get("day") != day:
            seen = self.last_seen.get(acc.id)
            eq0 = None
            if seen and seen["day"] != day and start_real - seen["at"] <= 120:
                eq0 = seen["equity"]
            elif now() - start_real <= 120:
                eq0 = live["equity"]
            ref = {"day": day, "equity": eq0}
            with self.lock:
                self.day_refs[acc.id] = ref
                self._save()
        self.last_seen[acc.id] = {"day": day, "equity": live["equity"], "at": now()}
        eq0 = ref.get("equity")
        if g.get("day_ref") == "higher" and eq0 is not None:
            return max(bal0, eq0), bal0, True
        return bal0, bal0, g.get("day_ref") != "higher"

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
        sig = tuple(sorted(p["ticket"] for p in live["positions"]))
        today = self._today(acc, g["server_offset"], sig)
        ref, bal0, ref_ok = self._day_ref(acc, g, live, today)
        day_loss = max(0.0, ref - live["equity"])
        day_profit = max(0.0, live["equity"] - ref)
        profit_limit = g.get("profit_limit", 0)
        day = today["day_start"]
        r = self.rule(acc.id, day)
        # Lệnh đầu tiên trong ngày (hoặc còn lệnh mở từ hôm trước): từ giờ các giới hạn chỉ siết được, không nới.
        if not r["active"] and (today["trades"] > 0 or live["positions"]):
            with self.lock:
                r.update(active=True, active_at=int(now() * 1000))
                self._save()
        # Đã chọn trade tiếp sau chốt lời: không chốt lời lần nữa, nhưng giữ phần lãi đã hứa giữ lại.
        hit_profit = profit_limit > 0 and day_profit >= profit_limit and not r["continued"]
        day_pl = live["equity"] - ref
        hit_keep = r["continued"] and r["protect"] is not None and day_pl <= r["protect"]
        used = day_loss / g["daily_limit"] if g["daily_limit"] > 0 else 0.0
        floor_used = 0.0
        if g["floor"] > 0 and g["max_loss"] > 0:
            floor_used = max(0.0, (g["max_loss"] - (live["equity"] - g["floor"])) / g["max_loss"])
        level = max(used, floor_used)
        st = self.states.get(acc.id, {})
        warned = st.get("warned", []) if st.get("day") == day else []
        next_day = day + 86400 - g["server_offset"] * 3600  # giờ máy chủ → epoch thật

        crossed = [th for th in g["warn_at"] if level >= th and th not in warned]
        warned += crossed
        if crossed and level < g["act_at"]:  # vượt nhiều ngưỡng một lúc thì chỉ báo một lần; chạm mức hành động thì tin khoá đã đủ
            what = "lỗ trong ngày" if used >= floor_used else "lỗ tổng"
            self.event("warn", acc.id, f"Đã dùng {level * 100:.0f}% giới hạn {what}. Lỗ hôm nay {day_loss:.2f} {live['currency']}, equity {live['equity']:.2f}.")

        reason = ""
        if hit_keep:
            reason = f"Lãi trong ngày tụt về {day_pl:.2f} {live['currency']} (mức giữ lại {r['protect']:.2f} sau khi trade tiếp)"
        elif hit_profit:
            reason = f"Đạt mục tiêu lãi ngày (+{day_profit:.2f} {live['currency']})"
        elif level >= g["act_at"]:
            reason = f"Chạm {level * 100:.0f}% giới hạn {'lỗ trong ngày' if used >= floor_used else 'lỗ tổng'}"
        elif g["max_consec_losses"] and today["consec_losses"] >= g["max_consec_losses"]:
            reason = f"Thua liên tiếp {today['consec_losses']} lệnh"
        elif g["max_trades"] and today["trades"] >= g["max_trades"]:
            reason = f"Đã vào {today['trades']} lệnh hôm nay (tối đa {g['max_trades']})"

        lock = self.locked(acc.id)
        if reason and not lock:
            hit_limit = level >= g["act_at"] or hit_profit or hit_keep
            # Chạm giới hạn (lỗ, lãi, mức giữ lại): luôn khoá tới hết ngày, không mở tay được. Đạt mục tiêu lãi có một lượt "trade tiếp".
            unlock_at = next_day if hit_limit else (now() + 1800 if g.get("hard_lock", True) else 0)
            kind = "profit" if hit_profit else "limit" if hit_limit else "behavior"
            with self.lock:
                self.locks[acc.id] = {"until": next_day, "reason": reason, "at": now(), "unlock_at": unlock_at, "kind": kind}
                self._save()
            lock = self.locks[acc.id]
            closed = ""
            if hit_limit and (g["close_on_breach"] or hit_keep) and live["positions"]:
                if acc.tradable:
                    res = acc.call("close_all", timeout=60)
                    closed = f" Đã đóng {res['closed']} lệnh." + (f" Lỗi: {'; '.join(res['errors'])}" if res["errors"] else "")
                else:
                    closed = " Không đóng được lệnh vì tài khoản chỉ có mật khẩu view: hãy tự đóng ngay."
            hard = (" Muốn trade tiếp: vào trang Bảo vệ, chọn số tiền được trả lại (một lần mỗi ngày)." if kind == "profit" and not r["continued"]
                    else " Không mở tay được." if unlock_at >= next_day else (" Mở tay được sau 30 phút." if unlock_at else ""))
            self.event("lock", acc.id, f"{reason}. Khoá vào lệnh tới hết ngày máy chủ.{hard}{closed}")
        elif lock and g["close_new_when_locked"] and acc.tradable:
            fresh = [p for p in live["positions"] if p["time"] - g["server_offset"] * 3600 > lock["at"]]
            if fresh:
                res = acc.call("close_all", timeout=60)
                self.event("lock", acc.id, f"Đang khoá ({lock['reason']}) nhưng có {len(fresh)} lệnh mới mở. Đã đóng {res['closed']} lệnh.")

        stops = self._stops(acc, g, live, ref, level, r)

        self.states[acc.id] = {
            "stops": stops, "day_ref": round(ref, 2), "ref_ok": ref_ok,
            "day": day, "warned": warned, "day_loss": round(day_loss, 2), "used": round(used, 4), "floor_used": round(floor_used, 4),
            "day_profit": round(day_profit, 2), "profit_used": round(day_profit / profit_limit, 4) if profit_limit > 0 else 0,
            "level": round(level, 4), "equity": live["equity"], "currency": live["currency"], "consec_losses": today["consec_losses"],
            "trades": today["trades"], "positions": len(live["positions"]), "tradable": acc.tradable, "error": "", "updated": int(now() * 1000),
        }

    def _stops(self, acc, g, live, ref, level, r=None):
        """Gắn/siết SL khẩn cấp trên sàn. Ngân sách = phần lỗ còn được phép trước ngưỡng hành động, tính cho cả hai giới hạn:
        nếu mọi lệnh cùng chạm SL thì lỗ ngày ≤ act_at × giới hạn ngày và equity ≥ sàn + (1 − act_at) × lỗ tổng."""
        prev = self.states.get(acc.id, {}).get("stops") or {"on": False, "protected": 0, "over": [], "budget": 0, "at": 0}
        if not g.get("hard_stop", True) or not acc.tradable or not live["positions"] or level >= g["act_at"]:
            return {"on": bool(g.get("hard_stop", True) and acc.tradable), "protected": 0, "over": [], "budget": 0, "at": prev.get("at", 0)}
        budgets = []
        if g["daily_limit"] > 0:
            budgets.append(g["act_at"] * g["daily_limit"] - (ref - live["balance"]))
        if g["floor"] > 0 and g["max_loss"] > 0:
            budgets.append(live["balance"] - g["floor"] - (1 - g["act_at"]) * g["max_loss"])
        if r and r.get("continued") and r.get("protect") is not None:
            # Trade tiếp sau chốt lời: mọi lệnh cùng chạm SL thì lãi trong ngày vẫn còn ít nhất mức giữ lại.
            budgets.append(live["balance"] - ref - r["protect"])
        if not budgets:
            return {"on": False, "protected": 0, "over": [], "budget": 0, "at": 0}
        budget = min(budgets)
        sig = tuple(sorted((p["ticket"], round(p["sl"], 6)) for p in live["positions"]))
        last = self.stop_runs.get(acc.id)
        # chạy lại khi lệnh/SL đổi, hoặc mỗi 30 giây (ngân sách đổi khi có lệnh chốt hoặc swap)
        if last and last[1] == sig and now() - last[0] < 30:
            return prev
        r = acc.call("emergency_stops", round(budget, 2), timeout=60)
        self.stop_runs[acc.id] = (now(), sig)
        if r["changed"]:
            parts = [f"{c['symbol']} #{c['ticket']} {c['old'] or 'không có'} → {c['new']}" for c in r["changed"]]
            self.event("stop", acc.id, f"SL khẩn cấp trên sàn (tổng lỗ tối đa {budget:.2f} {live['currency']} nếu mọi lệnh chạm SL): " + "; ".join(parts), notify=False)
        if r["errors"]:
            self.event("stop", acc.id, "Không gắn được SL khẩn cấp: " + "; ".join(r["errors"]))
        return {"on": True, "protected": r["positions"] - len(r["over"]), "over": r["over"], "budget": round(budget, 2), "at": int(now() * 1000)}

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
                    sl = mp["sl"]
                    if self.guards.get(acc.id, {}).get("hard_stop") and fp["sl"] > 0:
                        # tài khoản nhận có SL khẩn cấp: chỉ nhận SL chặt hơn, không để lệnh nguồn nới SL ra
                        buy = fp["side"] == "buy"
                        if sl <= 0 or (sl < fp["sl"] if buy else sl > fp["sl"]):
                            sl = fp["sl"]
                    if abs(fp["sl"] - sl) > 1e-9 or abs(fp["tp"] - mp["tp"]) > 1e-9:
                        try:
                            acc.call("modify", fp["ticket"], sl, mp["tp"], timeout=30)
                        except Exception as e:
                            self.copy_state["error"] = f"Sửa SL/TP #{fp['ticket']}: {e}"
        self.copy_state["last"] = int(now() * 1000)
