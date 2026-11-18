"""
Phần dành cho bản cài GoldenDuckBridge.exe: tự chạy khi bật máy, trang cài đặt trong trình duyệt, đọc mã kết nối.
Chạy bằng Python vẫn dùng được trang cài đặt (http://127.0.0.1:8787/setup).
"""
import re
import sys

from paths import FROZEN

RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
APP_NAME = "GoldenDuckBridge"


def parse_code(text):
    """Mã kết nối dán từ web: dạng ngắn gdb_xxx@ten-mien, hoặc nguyên dòng "server": {"url": ..., "token": ...}."""
    text = str(text or "").strip()
    m = re.search(r"(gdb_[A-Za-z0-9_-]{20,})@([A-Za-z0-9.-]+(?::\d+)?)", text)
    if m:
        host = m.group(2)
        scheme = "http" if host.startswith(("localhost", "127.0.0.1")) else "https"
        return {"url": f"{scheme}://{host}", "token": m.group(1)}
    url = re.search(r'"url"\s*:\s*"(https?://[^"]+)"', text)
    token = re.search(r'"token"\s*:\s*"(gdb_[A-Za-z0-9_-]+)"', text)
    if url and token:
        return {"url": url.group(1).rstrip("/"), "token": token.group(1)}
    raise ValueError("Mã kết nối không đúng. Trên web vào Tài khoản & gói → Kết nối máy MT5 → Tạo mã kết nối, rồi chép nguyên mã dán vào đây")


def autostart_supported():
    return sys.platform == "win32" and FROZEN


def autostart_enabled():
    if not autostart_supported():
        return False
    import winreg
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as k:
            winreg.QueryValueEx(k, APP_NAME)
            return True
    except OSError:
        return False


def set_autostart(on):
    """Tự chạy khi đăng nhập Windows (chỉ cho tài khoản Windows hiện tại, không cần quyền quản trị)."""
    if not autostart_supported():
        raise ValueError("Tự chạy khi bật máy chỉ có ở bản cài GoldenDuckBridge.exe trên Windows")
    import winreg
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as k:
        if on:
            winreg.SetValueEx(k, APP_NAME, 0, winreg.REG_SZ, f'"{sys.executable}"')
        else:
            try:
                winreg.DeleteValue(k, APP_NAME)
            except OSError:
                pass
    return autostart_enabled()


SETUP_HTML = """<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Golden Duck Bridge</title>
<style>
:root { --bg:#f4f6fb; --card:#fff; --ink:#152033; --muted:#5d6b82; --line:#dfe5ef; --accent:#2f6fde; --pos:#0f9d6a; --neg:#d9434f; }
@media (prefers-color-scheme: dark) { :root { --bg:#0e1524; --card:#172238; --ink:#e8eef8; --muted:#9fb0c8; --line:#2a3a56; --accent:#5b8ff0; --pos:#1fae78; --neg:#e5484d; } }
* { box-sizing: border-box; } body { margin:0; font: 15px/1.55 system-ui, "Segoe UI", sans-serif; background: var(--bg); color: var(--ink); }
main { max-width: 640px; margin: 0 auto; padding: 24px 16px 48px; } h1 { font-size: 22px; margin: 0 0 4px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 18px; margin: 14px 0; }
.muted { color: var(--muted); } .ok { color: var(--pos); font-weight: 600; } .bad { color: var(--neg); font-weight: 600; }
textarea { width: 100%; min-height: 70px; font: 13px ui-monospace, Consolas, monospace; padding: 10px; border-radius: 10px; border: 1px solid var(--line); background: var(--bg); color: var(--ink); }
button { font: inherit; padding: 9px 16px; border-radius: 10px; border: 1px solid var(--line); background: var(--card); color: var(--ink); cursor: pointer; }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; } a { color: var(--accent); }
ol { padding-left: 20px; } li { margin: 4px 0; } label { display: flex; gap: 8px; align-items: center; }
</style></head><body><main>
<h1>🦆 Golden Duck Bridge</h1>
<p class="muted">Chương trình này chạy trên máy có MT5, canh tài khoản và nhận lệnh từ Golden Duck trên web. Mật khẩu MT5 chỉ nằm trên máy này.</p>
<div class="card"><strong>Kết nối Golden Duck</strong><p id="link">Đang kiểm tra…</p>
<ol class="muted"><li>Trên web: <b>Tài khoản &amp; gói → Kết nối máy MT5 → Tạo mã kết nối</b>, bấm Chép.</li><li>Dán vào ô dưới đây rồi bấm Lưu.</li></ol>
<textarea id="code" placeholder="gdb_…@ten-mien-cua-ban.com"></textarea>
<p><button class="primary" onclick="saveCode()">Lưu và kết nối</button> <span id="msg"></span></p></div>
<div class="card"><strong>Tài khoản MT5</strong><p id="accounts" class="muted">…</p>
<p class="muted">Thêm hoặc gỡ tài khoản ở trang <b>Tài khoản</b> trên web. Mỗi tài khoản cần một bản MT5 cài ở thư mục riêng trên máy này.</p></div>
<div class="card"><strong>Chạy nền</strong>
<p><label><input type="checkbox" id="auto" onchange="setAuto(this.checked)"> Tự chạy khi bật máy</label></p>
<p class="muted" id="autonote">Chương trình chạy ngầm, có biểu tượng con vịt ở góc phải thanh Taskbar. Đóng trang này không tắt chương trình. Muốn tắt hẳn: bấm chuột phải vào biểu tượng → Thoát (bảo vệ tài khoản sẽ dừng).</p></div>
<script>
const H = { "Content-Type": "application/json", "X-FXDesk": "1" };
async function load() {
  const s = await (await fetch("/setup/state")).json();
  const l = document.getElementById("link");
  l.innerHTML = !s.server.url ? '<span class="bad">Chưa kết nối</span>'
    : s.server.connected ? `<span class="ok">● Đã kết nối</span> ${s.server.url}${s.server.email ? " · " + s.server.email : ""}`
    : `<span class="bad">● Chưa kết nối được</span> ${s.server.url}<br><span class="muted">${s.server.error || "Đang thử lại…"}</span>`;
  document.getElementById("accounts").textContent = s.accounts.length ? s.accounts.map(a => `${a.connected ? "●" : "○"} ${a.label}${a.error ? " (" + a.error + ")" : ""}`).join("  ·  ") : "Chưa có tài khoản nào.";
  const box = document.getElementById("auto"); box.checked = s.autostart; box.disabled = !s.autostart_supported;
  if (!s.autostart_supported) document.getElementById("autonote").textContent = "Tự chạy khi bật máy chỉ có ở bản cài GoldenDuckBridge.exe.";
}
async function saveCode() {
  const m = document.getElementById("msg"); m.textContent = "Đang lưu…";
  const r = await fetch("/setup/server", { method: "POST", headers: H, body: JSON.stringify({ code: document.getElementById("code").value }) });
  const j = await r.json(); m.textContent = r.ok ? "✓ Đã lưu. Vài giây nữa sẽ kết nối." : "⚠ " + j.error; m.className = r.ok ? "ok" : "bad";
  if (r.ok) document.getElementById("code").value = ""; setTimeout(load, 3000);
}
async function setAuto(on) { await fetch("/setup/autostart", { method: "POST", headers: H, body: JSON.stringify({ on }) }); load(); }
load(); setInterval(load, 5000);
</script></main></body></html>"""
