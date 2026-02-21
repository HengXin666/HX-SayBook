#!/bin/bash
# ============================================================
# Qwen3-TTS 启动脚本
# ============================================================

set -e

echo "========================================"
echo "  Qwen3-TTS 服务启动"
echo "  引擎: Qwen2.5-Omni TTS"
echo "========================================"

# 路径配置
WORKSPACE_PATH=${WORKSPACE_PATH:-/workspace}
APP_PATH=/app

# 确保目录存在
mkdir -p "$APP_PATH/prompts" "$APP_PATH/outputs/api"

# 如果工作区有自定义 api_server，使用工作区版本
if [[ -f "$WORKSPACE_PATH/api_server_qwen3.py" ]]; then
    echo "[配置] 复制 api_server_qwen3.py → $APP_PATH/"
    cp -f "$WORKSPACE_PATH/api_server_qwen3.py" "$APP_PATH/"
fi

cd "$APP_PATH"

# 环境变量
HOST=${QWEN3_TTS_HOST:-0.0.0.0}
PORT=${QWEN3_TTS_PORT:-8000}
MODEL=${QWEN3_TTS_MODEL:-Qwen/Qwen2.5-Omni-7B}
DEVICE=${QWEN3_TTS_DEVICE:-cuda}
DTYPE=${QWEN3_TTS_DTYPE:-auto}

echo ""
echo "[启动] API 服务监听 $HOST:$PORT"
echo "  模型: $MODEL"
echo "  设备: $DEVICE"
echo "  精度: $DTYPE"
echo ""

exec python api_server_qwen3.py \
    --host "$HOST" \
    --port "$PORT" \
    --model_name "$MODEL" \
    --device "$DEVICE" \
    --torch_dtype "$DTYPE"
