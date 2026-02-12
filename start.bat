@echo off
REM ============================================================
REM HX-SayBook 启动脚本 (Windows)
REM ============================================================

REM 检查 uv
where uv >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ 未找到 uv，正在安装...
    powershell -ExecutionPolicy Bypass -Command "irm https://astral.sh/uv/install.ps1 | iex"
    set "PATH=%USERPROFILE%\.local\bin;%PATH%"
)

echo 📦 安装后端依赖...
uv sync

echo 🚀 启动 HX-SayBook 后端...
uv run uvicorn app.main:app --host 0.0.0.0 --port 8200 --reload
