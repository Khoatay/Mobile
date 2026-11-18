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
# Tên sàn/quỹ và các chữ hay gặp trong tên máy chủ hoặc thư mục cài MT5 của họ.
BROKERS = [
    ("Exness", ("exness",)), ("IC Markets", ("icmarkets", "ic markets")), ("FTMO", ("ftmo",)),
    ("The5ers", ("fivepercent", "the5ers", "5ers")), ("TenTrade", ("tentrade",)), ("FundedNext", ("fundednext",)),
    ("XM", ("xmglobal", "xm.com", "xmtrading")), ("FxPro", ("fxpro",)), ("Pepperstone", ("pepperstone",)),
    ("Vantage", ("vantage",)), ("FBS", ("fbs",)), ("HFM", ("hfmarkets", "hotforex", "hfm")),
]


def is_clone(path):
    try:
        return CLONES.resolve() in Path(path).resolve().parents
    except OSError:
        return False


def broker_of(text):
    """Sàn/quỹ đoán từ tên máy chủ hoặc đường dẫn (ví dụ FivePercentOnline-Real → The5ers)."""
    t = str(text or "").lower().replace(" ", "")
    return next((name for name, keys in BROKERS if any(k.replace(" ", "") in t for k in keys)), "")


def company_of(exe):
    """Tên công ty ghi trong file terminal64.exe (MT5 của sàn nào ghi tên sàn đó). Chỉ đọc được trên Windows."""
    if sys.platform != "win32":
        return ""
    try:
        import ctypes
        v = ctypes.windll.version
        size = v.GetFileVersionInfoSizeW(str(exe), None)
        if not size:
            return ""
        buf = ctypes.create_string_buffer(size)
        if not v.GetFileVersionInfoW(str(exe), 0, size, buf):
            return ""
        ptr, n = ctypes.c_void_p(), ctypes.c_uint()
        if not v.VerQueryValueW(buf, "\\VarFileInfo\\Translation", ctypes.byref(ptr), ctypes.byref(n)) or not n.value:
            return ""
        lang = ctypes.cast(ptr, ctypes.POINTER(ctypes.c_ushort * 2)).contents
        key = f"\\StringFileInfo\\{lang[0]:04x}{lang[1]:04x}\\CompanyName"
        if not v.VerQueryValueW(buf, key, ctypes.byref(ptr), ctypes.byref(n)) or not n.value:
            return ""
        return ctypes.wstring_at(ptr, n.value - 1)
    except Exception:
        return ""


def _bases_of(exe):
    """Máy chủ bản MT5 này đã từng nối: thư mục bases ngay cạnh (bản portable) hoặc trong thư mục dữ liệu (bản cài thường)."""
    dirs = [Path(exe).parent / "bases"]
    data = data_dir_of(Path(exe).parent)
    if data:
        dirs.append(data / "bases")
    out = []
    for d in dirs:
        try:
            out += [x.name for x in d.iterdir() if x.is_dir()]
        except OSError:
            pass
    return out


def terminal_brokers(exe):
    """Bản MT5 này là của sàn/quỹ nào: theo đường dẫn, tên công ty trong file, và máy chủ đã từng nối."""
    names = {broker_of(exe), broker_of(company_of(exe))} | {broker_of(s) for s in _bases_of(exe)}
    return {n for n in names if n}


def pick_template(terminals, server):
    """Chọn bản MT5 mẫu khớp sàn của máy chủ. Trả (đường dẫn, tên sàn, có khớp không).
    Máy chủ của một sàn đã biết mà máy chưa có MT5 của sàn đó thì không khớp: bản sao sẽ không biết máy chủ của sàn."""
    broker = broker_of(server)
    if broker:
        for t in terminals:
            if broker in terminal_brokers(t):
                return t, broker, True
        return (terminals[0] if terminals else ""), broker, False
    return (terminals[0] if terminals else ""), "", True


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


def known_servers(terminals):
    """Tên máy chủ MT5 đã từng đăng nhập trên máy này. MT5 tạo thư mục bases\\<tên máy chủ> cho mỗi máy chủ đã nối,
    nên tên lấy ở đây chắc chắn đúng chính tả. Quét thư mục dữ liệu của các bản cài thường và các bản portable/tự tạo."""
    roots = []
    base = Path(os.environ.get("APPDATA") or "") / "MetaQuotes" / "Terminal"
    if base.is_dir():
        roots += [d / "bases" for d in base.iterdir() if d.is_dir()]
    roots += [Path(t).parent / "bases" for t in terminals]
    if CLONES.is_dir():
        roots += [d / "bases" for d in CLONES.iterdir() if d.is_dir()]
    names = set()
    for r in roots:
        try:
            for d in r.iterdir():
                n = d.name
                if d.is_dir() and n.lower() not in ("default", "signals", "symbols", "news") and any(c.isalpha() for c in n):
                    names.add(n)
        except OSError:
            continue
    return sorted(names, key=str.lower)
