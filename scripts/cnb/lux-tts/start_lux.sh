#!/bin/bash
# ============================================================
# LuxTTS 启动脚本
# 使用 LuxTTS 官方 API (ysharma3501/LuxTTS)
# ============================================================

set -e

echo "========================================"
echo "  LuxTTS 服务启动"
echo "  轻量级零样本 TTS 引擎 (48kHz)"
echo "========================================"

# 路径配置
LUXTTS_PATH=/app/luxtts                # 镜像内代码目录
WORKSPACE_PATH=/workspace              # CNB 挂载的工作区目录
OUTPUT_PATH=$WORKSPACE_PATH/outputs
PROMPT_PATH=$WORKSPACE_PATH/prompts

# 环境变量（可通过 docker run -e 覆盖）
WORKERS=${LUX_TTS_WORKERS:-1}
HOST=${LUX_TTS_HOST:-0.0.0.0}
PORT=${LUX_TTS_PORT:-8000}

# 确保目录存在
mkdir -p "$PROMPT_PATH" "$OUTPUT_PATH"

# 将工作区的 api_server_lux.py 覆盖到 luxtts 目录（如果存在）
if [[ -f "$WORKSPACE_PATH/api_server_lux.py" ]]; then
    echo "[配置] 复制 api_server_lux.py → $LUXTTS_PATH/"
    cp -f "$WORKSPACE_PATH/api_server_lux.py" "$LUXTTS_PATH/"
else
    echo "[配置] 使用镜像内默认 api_server_lux.py"
fi

# 切换到 luxtts 目录
cd "$LUXTTS_PATH" || exit 1

# ====== 检查环境 ======
echo ""
echo "[检查] Python 环境..."
python3 --version

echo "[检查] LuxTTS 模块..."
python3 -c "from zipvoice.luxvoice import LuxTTS; print('  ✅ LuxTTS 可导入')" 2>/dev/null || {
    echo "  ⚠️ LuxTTS 不可导入，尝试安装..."
    pip install --no-build-isolation . 2>/dev/null || pip install . 2>/dev/null || {
        echo "  ⚠️ pip install 失败，将依赖 PYTHONPATH"
    }
}
echo ""

# ====== 启动 API 服务 ======
echo "[启动] LuxTTS API 服务"
echo "  监听: ${HOST}:${PORT}"
echo "  并发 worker 数: ${WORKERS}"
echo "  显存占用: ~1GB"
echo "  输出采样率: 48kHz"
echo ""

exec python3 -m uvicorn api_server_lux:app \
    --host "$HOST" \
    --port "$PORT" \
    --workers "$WORKERS" \
    --timeout-keep-alive 600
