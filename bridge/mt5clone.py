"""
Tự tạo một bản MT5 riêng cho mỗi tài khoản, để khách chỉ cần cài MT5 một lần.

MT5 chỉ đăng nhập được một tài khoản mỗi lúc trong một bản cài. Bridge sao chép thư mục cài MT5 (bản "mẫu")
vào %APPDATA%\\GoldenDuck\\mt5\\<số tài khoản> rồi chạy bản đó ở chế độ portable (dữ liệu nằm ngay trong thư mục đó).
Danh sách máy chủ của sàn (servers.dat) ở bản cài thường nằm trong thư mục dữ liệu của MT5, nên chép cả file đó sang.
"""
import os
import shutil
import subprocess
import sys
from pathlib import Path

from paths import DATA

CLONES = DATA / "mt5"
# Dữ liệu MT5 tự tạo lại (lịch sử giá, nhật ký, kiểm thử): không chép cho nhẹ.
SKIP_TOP = {"logs", "tester", "bases", "history"}
BROKER_HINTS = ("exness", "icmarkets", "ic markets", "ftmo", "5ers", "fivepercent", "the5ers", "tentrade", "xm", "fxpro", "pepperstone", "vantage", "fbs", "hfm")


def is_clone(path):
    try:
        return CLONES.resolve() in Path(path).resolve().parents
    except OSError:
        return False


def pick_template(terminals, server):
    """Chọn bản MT5 mẫu khớp sàn nhất (theo tên máy chủ, ví dụ Exness-MT5Real8 → bản có chữ exness trong đường dẫn)."""
    s = str(server or "").lower().replace(" ", "")
    for hint in BROKER_HINTS:
        if hint.replace(" ", "") in s:
            for t in terminals:
                if hint in t.lower() or hint.replace(" ", "") in t.lower().replace(" ", ""):
                    return t
    return terminals[0] if terminals else ""


def _read_origin(f):
    raw = f.read_bytes()
    text = raw.decode("utf-16") if raw[:2] in (b"\xff\xfe", b"\xfe\xff") else raw.decode("utf-8", "ignore")
    return text.strip().strip("\x00").lower().rstrip("\\/")


def data_dir_of(install_dir):
    """Thư mục dữ liệu (%APPDATA%\\MetaQuotes\\Terminal\\<mã>) của một bản cài thường: tìm theo origin.txt."""
    base = Path(os.environ.get("APPDATA") or "") / "MetaQuotes" / "Terminal"
    want = str(Path(install_dir)).lower().rstrip("\\/")
    if not base.is_dir():
        return None
    for d in base.iterdir():
        f = d / "origin.txt"
        try:
            if f.is_file() and _read_origin(f) == want:
                return d
        except OSError:
            continue
    return None


def clone_terminal(template_exe, login):
    """Trả đường dẫn terminal64.exe của bản riêng cho tài khoản `login` (tạo mới nếu chưa có)."""
    src = Path(template_exe).parent
    dst = CLONES / str(login)
    exe = dst / "terminal64.exe"
    if exe.is_file():
        return str(exe)
    if not (src / "terminal64.exe").is_file():
        raise ValueError(f"Không thấy MT5 mẫu tại {template_exe}")
    CLONES.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_name(dst.name + ".tmp")
    shutil.rmtree(tmp, ignore_errors=True)
    try:
        shutil.copytree(src, tmp, ignore=lambda d, names: [n for n in names if Path(d) == src and n.lower() in SKIP_TOP])
    except OSError as e:
        shutil.rmtree(tmp, ignore_errors=True)
        raise RuntimeError(f"Không chép được MT5 (ổ đĩa đầy hoặc không có quyền?): {e}")
    data = data_dir_of(src)
    if data and (data / "Config" / "servers.dat").is_file():
        (tmp / "Config").mkdir(exist_ok=True)
        shutil.copy2(data / "Config" / "servers.dat", tmp / "Config" / "servers.dat")
    os.replace(tmp, dst)
    return str(exe)


def remove_clone(exe_path):
    """Gỡ tài khoản: tắt bản MT5 riêng đó rồi xoá thư mục (chỉ xoá thư mục do bridge tạo)."""
    if not is_clone(exe_path):
        return
    if sys.platform == "win32":
        p = str(Path(exe_path)).replace("'", "''")
        subprocess.run(["powershell", "-NoProfile", "-Command", f"Get-Process terminal64 -ErrorAction SilentlyContinue | Where-Object {{ $_.Path -eq '{p}' }} | Stop-Process -Force"],
                       capture_output=True, timeout=30, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    shutil.rmtree(Path(exe_path).parent, ignore_errors=True)
