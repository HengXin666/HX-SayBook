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

# 确保 Python 和动态库路径正确（docker exec 进容器时 Dockerfile ENV 可能未继承）
export PYTHONPATH="/app/zipvoice:${PYTHONPATH:-}"
export LD_LIBRARY_PATH="/usr/lib/x86_64-linux-gnu:/usr/local/lib:${LD_LIBRARY_PATH:-}"

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

# ====== 检查环境（仅检查并报告，所有依赖应在 Dockerfile 构建时已安装） ======
echo ""
echo "[检查] Python 环境..."
python3 --version
python3 -c "import torch; print('  PyTorch', torch.__version__)"

echo "[检查] 核心依赖..."
python3 -c "import torchaudio; print('  ✅ torchaudio', torchaudio.__version__)" 2>/dev/null || \
    echo "  ❌ torchaudio 不可用（请检查 Dockerfile）"

python3 -c "import torchcodec; print('  ✅ torchcodec', torchcodec.__version__)" 2>/dev/null || \
    echo "  ⚠️ torchcodec 不可用（将使用 soundfile 后端）"

python3 -c "import soundfile; print('  ✅ soundfile', soundfile.__version__)" 2>/dev/null || \
    echo "  ⚠️ soundfile 不可用"

if command -v ffmpeg &>/dev/null; then
    echo "  ✅ FFmpeg: $(ffmpeg -version 2>&1 | head -1)"
else
    echo "  ⚠️ FFmpeg 未安装（torchcodec 需要）"
fi

echo ""
echo "[检查] ZipVoice 推理模块..."
python3 -c "from zipvoice.bin import infer_zipvoice; print('  ✅ zipvoice.bin.infer_zipvoice 可导入')" 2>/dev/null || \
    echo "  ⚠️ zipvoice.bin.infer_zipvoice 不可导入（将依赖 PYTHONPATH）"

python3 -m zipvoice.bin.infer_zipvoice --help > /dev/null 2>&1 && \
    echo "  ✅ python3 -m zipvoice.bin.infer_zipvoice 可用" || \
    echo "  ⚠️ python3 -m zipvoice.bin.infer_zipvoice 不可用"

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
