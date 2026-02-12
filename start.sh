#!/usr/bin/env bash
# ============================================================
# HX-SayBook 启动脚本 (Linux/macOS)
# ============================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 检查 uv
if ! command -v uv &> /dev/null; then
    echo "❌ 未找到 uv，正在安装..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
fi

echo "📦 安装后端依赖..."
cd "$SCRIPT_DIR"
uv sync

echo "🚀 启动 HX-SayBook 后端..."
uv run uvicorn app.main:app --host 0.0.0.0 --port 8200 --reload
