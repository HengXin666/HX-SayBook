import os
import sys
import shutil
import platform
from pathlib import Path


def get_data_dir() -> str:
    """获取数据存储目录，跨平台支持"""
    if platform.system() == "Windows":
        base = os.path.join(os.path.expanduser("~"), "HX-SayBook")
    else:
        # Linux / macOS 使用 XDG 规范
        xdg = os.environ.get(
            "XDG_DATA_HOME", os.path.join(os.path.expanduser("~"), ".local", "share")
        )
        base = os.path.join(xdg, "hx-saybook")
    os.makedirs(base, exist_ok=True)
    return base


# 兼容旧接口
def getConfigPath() -> str:
    return get_data_dir()


def getFfmpegPath() -> str:
    """
    获取 ffmpeg 可执行路径：
    1. 优先查找项目内置的 ffmpeg
    2. 其次使用系统 PATH 中的 ffmpeg
    """
    exe_name = "ffmpeg.exe" if platform.system() == "Windows" else "ffmpeg"

    # 打包后的路径
    base_dir = getattr(sys, "_MEIPASS", Path(os.path.abspath(".")))
    bundled = os.path.join(base_dir, "core", "ffmpeg", exe_name)
    if os.path.isfile(bundled):
        return bundled

    # 项目目录内
    project_ffmpeg = os.path.join(os.path.dirname(__file__), "ffmpeg", exe_name)
    if os.path.isfile(project_ffmpeg):
        return project_ffmpeg

    # 系统 PATH
    sys_ffmpeg = shutil.which("ffmpeg")
    if sys_ffmpeg:
        return sys_ffmpeg

    raise FileNotFoundError(
        "未找到 ffmpeg，请安装 ffmpeg 并确保在 PATH 中，"
        "或将 ffmpeg 放到 app/core/ffmpeg/ 目录下。\n"
        "Arch Linux: sudo pacman -S ffmpeg\n"
        "Windows: https://www.gyan.dev/ffmpeg/builds/"
    )
