#!/usr/bin/env bash
# ============================================================
# 运行 TTS 服务的脚本, 适用于索引生成阶段
# 支持: 中文 / 日语 / 小显存模式
# ============================================================
set -e
cd "$(dirname "$0")/index-tts" # 进入脚本所在目录

if [[ -d ".venv" ]]; then
    source .venv/bin/activate
elif [[ -d "venv" ]]; then
    source venv/bin/activate
fi

# 拷贝 api_server.py 到 index-tts 目录
cp ../api_server.py api_server.py

echo "========================================"
echo "  Index-TTS 服务启动"
echo "  支持: 中文 / 日语 / 小显存模式"
echo "========================================"

# ====== 检查模型文件 ======
echo ""
echo "[检查] 中文模型..."
ZH_MODEL_DIR=checkpoints
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
    echo "  如需日语支持，请手动下载模型:"
    echo "  https://huggingface.co/Jmica/IndexTTS-2-Japanese"
fi

# ====== 询问是否启用小显存模型 ======
echo ""
read -p "是否启用小显存模型 (8GB 显存)? (y/n) " use_small_model
if [[ "$use_small_model" == "y" ]]; then
    export USE_SMALL_MODEL=true
    echo "已启用小显存模型 (8GB 显存)"
else
    export USE_SMALL_MODEL=false
    echo "未启用小显存模型, 使用默认模型"
fi

# ====== 启动 API 服务 ======
echo ""
echo "[启动] API 服务监听 0.0.0.0:8000"
echo "  中文模型: $ZH_MODEL_DIR"
echo "  日语模型: $JA_MODEL_DIR ($( [[ "$JA_OK" == true ]] && echo '可用' || echo '不可用' ))"
echo "  小显存模式: $( [[ "$USE_SMALL_MODEL" == true ]] && echo '已启用 (fp16)' || echo '未启用' )"
echo ""

# 运行 TTS 服务
if [[ "$USE_SMALL_MODEL" == true ]]; then
    echo "运行 TTS 服务, 使用小显存模型 (8GB 显存)"
    python api_server.py --host 0.0.0.0 --port 8000 --fp16
else
    echo "运行 TTS 服务, 使用默认模型"
    python api_server.py --host 0.0.0.0 --port 8000
fi
