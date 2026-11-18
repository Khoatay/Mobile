"""Nơi lưu dữ liệu của bridge (config.json, kiến thức, trạng thái bảo vệ…).

- Chạy bằng Python (python bridge.py): ngay trong thư mục bridge như trước.
- Chạy bằng GoldenDuckBridge.exe: %APPDATA%\\GoldenDuck, vì thư mục chứa file .exe có thể không ghi được.
- Đặt biến môi trường GD_DATA_DIR để chọn nơi khác.
"""
import os
import sys
from pathlib import Path

FROZEN = bool(getattr(sys, "frozen", False))


def _data_dir():
    if os.environ.get("GD_DATA_DIR"):
        return Path(os.environ["GD_DATA_DIR"])
    if FROZEN:
        return Path(os.environ.get("APPDATA") or Path.home()) / "GoldenDuck"
    return Path(__file__).resolve().parent


DATA = _data_dir()
DATA.mkdir(parents=True, exist_ok=True)
