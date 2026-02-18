#!/bin/bash
# ============================================================
# LuxTTS (ZipVoice) 启动脚本
# 支持 8 个并发 worker（显存占用约 1GB/实例）
# ============================================================

set -e

echo "========================================"
echo "  LuxTTS (ZipVoice) 服务启动"
echo "  轻量级零样本 TTS 引擎"
echo "========================================"

# 路径配置
ZIPVOICE_PATH=/app/zipvoice            # 镜像内代码目录
WORKSPACE_PATH=/workspace              # CNB 挂载的工作区目录
OUTPUT_PATH=$WORKSPACE_PATH/outputs
PROMPT_PATH=$WORKSPACE_PATH/prompts

# 环境变量（可通过 docker run -e 覆盖）
WORKERS=${LUX_TTS_WORKERS:-8}
HOST=${LUX_TTS_HOST:-0.0.0.0}
PORT=${LUX_TTS_PORT:-8000}
MODEL_NAME=${LUX_TTS_MODEL:-zipvoice}

# 确保目录存在
mkdir -p "$PROMPT_PATH" "$OUTPUT_PATH"

# 将工作区的 api_server_lux.py 覆盖到 zipvoice 目录（如果存在）
if [[ -f "$WORKSPACE_PATH/api_server_lux.py" ]]; then
    echo "[配置] 复制 api_server_lux.py → $ZIPVOICE_PATH/"
    cp -f "$WORKSPACE_PATH/api_server_lux.py" "$ZIPVOICE_PATH/"
else
    echo "[配置] 使用镜像内默认 api_server_lux.py"
fi

# 切换到 zipvoice 目录
cd "$ZIPVOICE_PATH" || exit 1

# ====== 检查环境 ======
echo ""
echo "[检查] Python 环境..."
python3 --version
echo "[检查] ZipVoice 模块..."
python3 -c "import zipvoice; print('  ✅ ZipVoice 模块可用')" 2>/dev/null || {
    echo "  ⚠️ ZipVoice 模块不可用，尝试安装..."
    pip install -e .
}

# ====== 启动 API 服务 ======
echo ""
echo "[启动] LuxTTS API 服务"
echo "  监听: ${HOST}:${PORT}"
echo "  模型: ${MODEL_NAME}"
echo "  并发 worker 数: ${WORKERS}"
echo "  显存占用: ~1GB (轻量模式)"
echo ""

# 使用 uvicorn 启动，支持多 worker 并发
# ZipVoice 显存占用小，可以启动多个 worker 同时处理请求
exec python3 -m uvicorn api_server_lux:app \
    --host "$HOST" \
    --port "$PORT" \
    --workers "$WORKERS" \
    --timeout-keep-alive 600
