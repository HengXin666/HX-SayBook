#!/bin/bash
# ============================================================
# Index-TTS 启动脚本（CNB 平台 /workspace 下）
# 支持中文 + 日语模型
# ============================================================

set -e

echo "========================================"
echo "  Index-TTS 服务启动"
echo "  支持: 中文 / 日语"
echo "========================================"

# 路径配置
INDEX_TTS_PATH=/app/index-tts         # 镜像内代码目录
WORKSPACE_PATH=/workspace             # CNB 挂载的工作区目录
OUTPUT_PATH=$WORKSPACE_PATH/outputs
PROMPT_PATH=$WORKSPACE_PATH/prompts

# 确保目录存在
mkdir -p "$PROMPT_PATH" "$OUTPUT_PATH"

# 将工作区的 api.py 覆盖到 index-tts 目录（如果存在）
if [[ -f "$WORKSPACE_PATH/api.py" ]]; then
    echo "[配置] 复制 api.py → $INDEX_TTS_PATH/"
    cp -f "$WORKSPACE_PATH/api.py" "$INDEX_TTS_PATH/"
else
    echo "[配置] 未找到 $WORKSPACE_PATH/api.py，使用镜像内默认版本"
fi

# 切换到 index-tts 目录
cd "$INDEX_TTS_PATH" || exit 1

# ====== 检查模型文件 ======
echo ""
echo "[检查] 中文模型..."
ZH_MODEL_DIR=$INDEX_TTS_PATH/checkpoints
ZH_FILES=("bpe.model" "gpt.pth" "config.yaml" "s2mel.pth" "wav2vec2bert_stats.pt")
for f in "${ZH_FILES[@]}"; do
    if [[ ! -f "$ZH_MODEL_DIR/$f" ]]; then
        echo "  ❌ 缺少: $f"
        echo "  请确保中文模型文件存在于 $ZH_MODEL_DIR"
        exit 1
    fi
done
echo "  ✅ 中文模型就绪"

echo "[检查] 日语模型..."
JA_MODEL_DIR=$ZH_MODEL_DIR/ja
JA_FILES=("bpe.model" "gpt.pth" "config.yaml")
JA_OK=true
for f in "${JA_FILES[@]}"; do
    if [[ ! -f "$JA_MODEL_DIR/$f" ]]; then
        echo "  ⚠️  缺少: $f"
        JA_OK=false
    fi
done

if [[ "$JA_OK" == true ]]; then
    echo "  ✅ 日语模型就绪"
else
    echo "  ⚠️  日语模型不完整，日语合成将不可用"
    echo "  如需日语支持，请使用包含日语模型的镜像，或手动下载:"
    echo "  https://huggingface.co/Jmica/IndexTTS-2-Japanese"
fi

# ====== 启动 API 服务 ======
echo ""
echo "[启动] API 服务监听 0.0.0.0:8000"
echo "  中文模型: $ZH_MODEL_DIR"
echo "  日语模型: $JA_MODEL_DIR ($( [[ "$JA_OK" == true ]] && echo '可用' || echo '不可用' ))"
echo ""

exec uv run api.py
