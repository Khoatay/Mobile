"""
Bot Telegram để nhận cảnh báo: người dùng tạo bot riêng với @BotFather, dán token vào app,
rồi bấm Start một lần là nối (không cần số điện thoại, api_id hay đăng nhập).

- Token và chat đã nối lưu trong bridge/telegram_bot.json (không đưa lên git).
- Chỉ nhận lệnh từ đúng chat đã nối; người lạ bấm Start với mã sai thì bị từ chối.
- Gõ "tắt" trong chat để dừng mọi cảnh báo tin đang nhắc lặp.
Dùng Bot API qua HTTPS (urllib), không cần thư viện thêm.
"""
import json
import os
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
FILE = HERE / "telegram_bot.json"
API = "https://api.telegram.org/bot{token}/{method}"
STOP_WORDS = {"tắt", "tat", "/tat", "/stop", "stop", "off", "dừng", "dung"}


class TelegramBot:
    def __init__(self):
        self.lock = threading.Lock()
        data = {}
        if FILE.exists():
            try:
                data = json.loads(FILE.read_text(encoding="utf-8"))
            except ValueError:
                data = {}
        self.token = data.get("token", "")
        self.username = data.get("username", "")
        self.chat_id = data.get("chat_id")
        self.chat_name = data.get("chat_name", "")
        self.code = data.get("code") or secrets.token_hex(4)
        self.offset = 0
        self.error = ""
        self.on_stop = None  # gọi khi người dùng gõ "tắt"
        self.thread = None

    # ------------------------------------------------------------- lưu, gọi API
    def _save(self):
        tmp = FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps({"token": self.token, "username": self.username, "chat_id": self.chat_id, "chat_name": self.chat_name, "code": self.code}, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, FILE)

    def _call(self, method, params=None, timeout=15, token=None):
        url = API.format(token=token or self.token, method=method)
        body = urllib.parse.urlencode(params or {}).encode()
        try:
            with urllib.request.urlopen(urllib.request.Request(url, data=body), timeout=timeout) as r:
                out = json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            try:
                out = json.loads(e.read().decode())
            except ValueError:
                raise RuntimeError(f"Telegram trả lỗi {e.code}")
        except urllib.error.URLError as e:
            raise RuntimeError(f"Không kết nối được Telegram: {e.reason}")
        if not out.get("ok"):
            raise RuntimeError(out.get("description") or "Telegram từ chối yêu cầu")
        return out["result"]

    # ------------------------------------------------------------- API cho app
    def status(self):
        return {
            "configured": bool(self.token), "username": self.username, "linked": self.chat_id is not None,
            "chat_name": self.chat_name, "code": self.code if self.token else "",
            "link": f"https://t.me/{self.username}?start={self.code}" if self.username else "", "error": self.error,
        }

    def set_token(self, body):
        token = str(body.get("token") or "").strip()
        if not token:
            raise ValueError("Dán token của bot (dạng 123456789:ABC...) do @BotFather gửi")
        me = self._call("getMe", token=token)  # kiểm tra token trước khi lưu
        with self.lock:
            self.token, self.username = token, me.get("username", "")
            self.chat_id, self.chat_name, self.code, self.error = None, "", secrets.token_hex(4), ""
            self._save()
        self.start()
        return self.status()

    def unlink(self):
        with self.lock:
            self.chat_id, self.chat_name, self.code = None, "", secrets.token_hex(4)
            self._save()
        return self.status()

    def remove(self):
        with self.lock:
            self.token = self.username = self.chat_name = ""
            self.chat_id = None
            self._save()
        return self.status()

    def send(self, text):
        """Gửi cảnh báo vào chat đã nối. Trả False nếu chưa nối (để nơi gọi dùng cách khác)."""
        if not self.token or self.chat_id is None:
            return False
        try:
            self._call("sendMessage", {"chat_id": self.chat_id, "text": text, "disable_web_page_preview": "true"})
            return True
        except RuntimeError as e:
            self.error = str(e)
            print(f"[bot] Không gửi được: {e}")
            return False

    def test(self):
        if self.chat_id is None:
            raise RuntimeError("Bot chưa nối với chat nào: bấm 'Mở Telegram để kết nối' rồi bấm Start")
        if not self.send("Golden Duck: tin nhắn thử. Cảnh báo bảo vệ tài khoản và tin tức sẽ gửi vào đây. Gõ \"tắt\" để dừng cảnh báo tin đang nhắc."):
            raise RuntimeError(self.error or "Không gửi được")
        return {"sent": True}

    # ------------------------------------------------------------- nghe tin nhắn
    def _handle(self, msg):
        chat = msg.get("chat", {})
        text = (msg.get("text") or "").strip()
        name = " ".join(x for x in (chat.get("first_name"), chat.get("last_name")) if x) or chat.get("title") or chat.get("username") or ""
        if text.startswith("/start"):
            arg = text[6:].strip()
            if self.chat_id is None and arg == self.code:
                with self.lock:
                    self.chat_id, self.chat_name = chat.get("id"), name
                    self._save()
                self._call("sendMessage", {"chat_id": self.chat_id, "text": "✅ Đã nối với Golden Duck. Cảnh báo sẽ gửi vào đây. Gõ \"tắt\" bất cứ lúc nào để dừng cảnh báo tin đang nhắc."})
                print(f"[bot] Đã nối với {name}")
            elif chat.get("id") != self.chat_id:
                self._call("sendMessage", {"chat_id": chat.get("id"), "text": "Mã kết nối không đúng. Hãy bấm nút 'Mở Telegram để kết nối' trong app Golden Duck."})
            return
        if chat.get("id") != self.chat_id:
            return  # không nhận lệnh từ người lạ
        if text.lower() in STOP_WORDS:
            n = self.on_stop() if self.on_stop else 0
            self._call("sendMessage", {"chat_id": self.chat_id, "text": f"🔕 Đã tắt {n} cảnh báo tin đang nhắc." if n else "Không có cảnh báo nào đang nhắc."})

    def _run(self):
        while self.token:
            try:
                updates = self._call("getUpdates", {"offset": self.offset, "timeout": 25}, timeout=35)
                self.error = ""
                for u in updates:
                    self.offset = u["update_id"] + 1
                    if "message" in u:
                        self._handle(u["message"])
            except RuntimeError as e:
                self.error = str(e)
                time.sleep(10)
            except Exception as e:  # không để luồng nghe chết vì một tin lạ
                print(f"[bot] Lỗi: {e}")
                time.sleep(5)

    def start(self):
        if not self.token or (self.thread and self.thread.is_alive()):
            return
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()
