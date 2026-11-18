"""
Nối bridge lên máy chủ Golden Duck để dùng bản web trên tên miền (mở từ máy nào, kể cả điện thoại, cũng dùng được MT5 trên máy này).

Bridge tự gọi ra máy chủ (long-poll), nên không phải mở cổng hay cấu hình mạng: máy chủ chuyển yêu cầu của bạn
từ trình duyệt xuống, bridge làm trên chính nó (cổng 127.0.0.1) rồi gửi kết quả lên. Mật khẩu MT5 không rời máy này.

Cấu hình trong config.json:
    "server": {"url": "https://ten-mien-cua-ban.com", "token": "gdb_..."}
Mã lấy ở bản web: Tài khoản & gói → Kết nối máy MT5.
"""
import json
import threading
import time
import urllib.error
import urllib.request

WORKERS = 4  # số yêu cầu làm song song (ví dụ một lệnh AI phân tích dài không chặn việc cập nhật tài khoản)


class ServerLink:
    def __init__(self, cfg, local_port):
        self.local = f"http://127.0.0.1:{local_port}"
        self.connected = False
        self.error = ""
        self.email = ""
        self.started = False
        self.configure(cfg)

    def configure(self, cfg):
        """Đổi máy chủ/mã kết nối khi đang chạy (trang cài đặt của bản .exe)."""
        cfg = cfg or {}
        self.url = str(cfg.get("url") or "").rstrip("/")
        self.token = str(cfg.get("token") or "")
        self.connected, self.error, self.email = False, "", ""
        if self.configured:
            if self.started:
                threading.Thread(target=self._hello, daemon=True).start()
            else:
                self.start()

    @property
    def configured(self):
        return bool(self.url and self.token)

    def _post(self, path, body, timeout):
        req = urllib.request.Request(self.url + path, data=json.dumps(body).encode("utf-8"), method="POST",
                                     headers={"Content-Type": "application/json", "Authorization": f"Bearer {self.token}"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8") or "{}")

    def start(self):
        if not self.configured or self.started:
            return
        self.started = True
        self._hello()
        for _ in range(WORKERS):
            threading.Thread(target=self._loop, daemon=True).start()

    def _hello(self):
        try:
            req = urllib.request.Request(self.url + "/api/bridge/me", headers={"Authorization": f"Bearer {self.token}"})
            with urllib.request.urlopen(req, timeout=15) as r:
                self.email = json.loads(r.read().decode("utf-8")).get("email", "")
            print(f"[máy chủ] đã nối {self.url} bằng tài khoản {self.email}")
        except urllib.error.HTTPError as e:
            self.error = "Mã kết nối không đúng hoặc đã tạo lại: lấy mã mới ở bản web" if e.code == 401 else f"Máy chủ trả lỗi {e.code}"
            print(f"[máy chủ] {self.error}")
        except Exception as e:
            print(f"[máy chủ] chưa nối được {self.url}: {e}. Sẽ thử lại.")

    def _loop(self):
        wait = 1
        while True:
            if not self.configured:
                time.sleep(2)
                continue
            try:
                job = self._post("/api/bridge/poll", {}, timeout=40)
                self.connected, self.error, wait = True, "", 1
                if job.get("id"):
                    self._run(job)
            except urllib.error.HTTPError as e:
                self.connected = False
                self.error = "Mã kết nối không đúng hoặc đã tạo lại: lấy mã mới ở bản web" if e.code == 401 else f"Máy chủ trả lỗi {e.code}"
                time.sleep(30 if e.code == 401 else wait)
                wait = min(wait * 2, 30)
            except Exception as e:
                self.connected, self.error = False, f"Mất kết nối máy chủ: {e}"
                time.sleep(wait)
                wait = min(wait * 2, 30)

    def _run(self, job):
        """Làm yêu cầu trên chính bridge (cùng các kiểm tra như khi mở app trên máy này) rồi gửi kết quả lên."""
        method = "POST" if job.get("method") == "POST" else "GET"
        data = json.dumps(job.get("body") or {}).encode("utf-8") if method == "POST" else None
        req = urllib.request.Request(self.local + str(job.get("path") or "/"), data=data, method=method,
                                     headers={"Content-Type": "application/json", "X-FXDesk": "1", "X-GD-Relay": "1"})
        try:
            with urllib.request.urlopen(req, timeout=900) as r:
                status, body = r.status, json.loads(r.read().decode("utf-8") or "null")
        except urllib.error.HTTPError as e:
            status = e.code
            try:
                body = json.loads(e.read().decode("utf-8") or "{}")
            except ValueError:
                body = {"error": f"Lỗi {e.code}"}
        except Exception as e:
            status, body = 502, {"error": f"Bridge không làm được yêu cầu: {e}"}
        for attempt in range(3):
            try:
                self._post("/api/bridge/reply", {"id": job["id"], "status": status, "body": body}, timeout=60)
                return
            except Exception:
                time.sleep(1 + attempt)
