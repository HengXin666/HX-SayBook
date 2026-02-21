#!/bin/bash
# ============================================================
# Fish-Speech 1.5 启动脚本（极速模式）
# 先启动 Fish-Speech 原生 API server，再启动 HX-SayBook 适配层
# ============================================================

set -e

echo "========================================"
echo "  Fish-Speech 1.5 极速模式"
echo "  单说话人 / 极速推理 / 显存 ≥4GB"
echo "========================================"

# 路径配置
WORKSPACE_PATH=${WORKSPACE_PATH:-/workspace}
APP_PATH=/app
FISH_SPEECH_PATH=/app/fish-speech

# 确保目录存在
mkdir -p "$APP_PATH/prompts" "$APP_PATH/outputs/api"

# 如果工作区有自定义 api_server，使用工作区版本
if [[ -f "$WORKSPACE_PATH/api_server_fish.py" ]]; then
    echo "[配置] 复制 api_server_fish.py → $APP_PATH/"
    cp -f "$WORKSPACE_PATH/api_server_fish.py" "$APP_PATH/"
fi

# 环境变量
HOST=${FISH_TTS_HOST:-0.0.0.0}
PORT=${FISH_TTS_PORT:-8000}
MODE=${FISH_TTS_MODE:-proxy}
FISH_API=${FISH_API_URL:-http://localhost:8080}
MODEL_PATH=${FISH_MODEL_PATH:-$FISH_SPEECH_PATH/checkpoints/fish-speech-1.5}
DEVICE=${FISH_TTS_DEVICE:-cuda}

echo ""
echo "[配置] 模式: $MODE"
echo "[配置] 适配层端口: $PORT"

if [[ "$MODE" == "proxy" ]]; then
    echo "[配置] Fish-Speech API: $FISH_API"

    # 启动 Fish-Speech 原生 API server（后台）
    echo ""
    echo "[启动] Fish-Speech 原生 API server..."
    cd "$FISH_SPEECH_PATH"
    python tools/api_server.py \
        --listen 0.0.0.0:8080 \
        --llama-checkpoint-path "$MODEL_PATH" \
        --decoder-checkpoint-path "$MODEL_PATH" \
        --compile &
    FISH_PID=$!

    # 等待 Fish-Speech 启动
    echo "[等待] Fish-Speech API server 启动中..."
    for i in $(seq 1 60); do
        if curl -s http://localhost:8080/ > /dev/null 2>&1; then
            echo "[就绪] Fish-Speech API server 已启动"
            break
        fi
        if ! kill -0 $FISH_PID 2>/dev/null; then
            echo "[错误] Fish-Speech API server 进程已退出"
            exit 1
        fi
        sleep 2
    done

    # 启动 HX-SayBook 适配层
    echo ""
    echo "[启动] HX-SayBook 适配层..."
    cd "$APP_PATH"
    exec python api_server_fish.py \
        --host "$HOST" \
        --port "$PORT" \
        --mode proxy \
        --fish_api "$FISH_API"

else
    # 独立模式
    echo "[配置] 模型路径: $MODEL_PATH"
    echo ""
    echo "[启动] 独立模式..."
    cd "$APP_PATH"
    exec python api_server_fish.py \
        --host "$HOST" \
        --port "$PORT" \
        --mode standalone \
        --model_path "$MODEL_PATH" \
        --device "$DEVICE"
fi
