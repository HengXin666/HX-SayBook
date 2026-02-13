#!/usr/bin/env bash
# 运行 TTS 服务的脚本, 适用于索引生成阶段
set -e
cd "$(dirname "$0")/index-tts" # 进入脚本所在目录

if [[ -d ".venv" ]]; then
    source .venv/bin/activate
elif [[ -d "venv" ]]; then
    source venv/bin/activate
fi

# 拷贝 api_server.py 到 index-tts 目录
cp ../api_server.py api_server.py

# 询问是否启用 小显存模型 (8GB 显存)
read -p "是否启用小显存模型 (8GB 显存)? (y/n) " use_small_model
if [[ "$use_small_model" == "y" ]]; then
    export USE_SMALL_MODEL=true
    echo "已启用小显存模型 (8GB 显存)"
else
    export USE_SMALL_MODEL=false
    echo "未启用小显存模型, 使用默认模型"
fi

# 运行 TTS 服务
if [[ "$USE_SMALL_MODEL" == true ]]; then
    echo "运行 TTS 服务, 使用小显存模型 (8GB 显存)"
    python api_server.py --host 0.0.0.0 --port 8000 --fp16
else
    echo "运行 TTS 服务, 使用默认模型"
    python api_server.py --host 0.0.0.0 --port 8000
fi
