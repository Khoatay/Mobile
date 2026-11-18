"""
Điểm vào của GoldenDuckBridge.exe: chạy bridge ngầm (không có cửa sổ đen), biểu tượng con vịt ở khay hệ thống,
lần đầu mở trang cài đặt trong trình duyệt để dán mã kết nối.

Chạy thử bằng Python: python app.py
"""
import multiprocessing
import os
import socket
import sys
import threading
import time
import webbrowser

if __name__ == "__main__":
    multiprocessing.freeze_support()  # bắt buộc cho tiến trình con (mỗi tài khoản MT5 một tiến trình) trong file .exe

from paths import DATA, FROZEN

LOG = DATA / "bridge.log"


def _log_to_file():
    """Bản .exe không có cửa sổ: ghi mọi dòng thông báo vào bridge.log (giữ tối đa khoảng 5 MB)."""
    if LOG.exists() and LOG.stat().st_size > 5_000_000:
        LOG.replace(LOG.with_suffix(".old.log"))
    f = open(LOG, "a", encoding="utf-8", buffering=1)
    sys.stdout = sys.stderr = f
    print(f"\n===== {time.strftime('%Y-%m-%d %H:%M:%S')} khởi động =====")


def _port():
    try:
        import json
        return int(json.loads((DATA / "config.json").read_text(encoding="utf-8-sig")).get("port", 8787))
    except Exception:
        return 8787


def _already_running(port):
    with socket.socket() as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


def _tray(port, link):
    """Biểu tượng ở khay hệ thống: mở trang cài đặt, mở web, xem nhật ký, thoát."""
    try:
        import pystray
        from PIL import Image, ImageDraw
    except ImportError:
        return False
    icon_file = os.path.join(getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__))), "icon.png")
    if os.path.exists(icon_file):
        image = Image.open(icon_file)
    else:
        image = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
        ImageDraw.Draw(image).ellipse((6, 6, 58, 58), fill=(245, 190, 40, 255))
    setup = f"http://127.0.0.1:{port}/setup"
    menu = pystray.Menu(
        pystray.MenuItem("Trang cài đặt", lambda: webbrowser.open(setup), default=True),
        pystray.MenuItem("Mở Golden Duck trên web", lambda: webbrowser.open(link.url or setup)),
        pystray.MenuItem("Xem nhật ký", lambda: os.startfile(str(LOG)) if hasattr(os, "startfile") else None),
        pystray.MenuItem("Thoát (bảo vệ tài khoản sẽ dừng)", lambda icon: (icon.stop(), os._exit(0))),
    )
    pystray.Icon("GoldenDuckBridge", image, "Golden Duck Bridge", menu).run()
    return True


def run():
    if FROZEN:
        _log_to_file()
    port = _port()
    if _already_running(port):
        webbrowser.open(f"http://127.0.0.1:{port}/setup")  # mở lần hai: chỉ mở trang cài đặt
        return
    import bridge
    started = threading.Event()
    state = {}

    def ready(p, link):
        state.update(port=p, link=link)
        started.set()
        if not link.configured:
            webbrowser.open(f"http://127.0.0.1:{p}/setup")  # lần đầu: dán mã kết nối

    threading.Thread(target=bridge.main, kwargs={"ready": ready}, daemon=True).start()
    if not started.wait(120):
        print("Bridge không khởi động được trong 2 phút")
        return
    if not _tray(state["port"], state["link"]):
        while True:  # không có thư viện khay hệ thống: cứ chạy ngầm
            time.sleep(3600)


if __name__ == "__main__":
    run()
