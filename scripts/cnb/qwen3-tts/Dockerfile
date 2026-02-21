# ============================================================
# Qwen3-TTS 镜像
# 基于 PyTorch CUDA 镜像，部署 Qwen2.5-Omni TTS 服务
# ============================================================
FROM pytorch/pytorch:2.4.0-cuda12.4-cudnn9-runtime

# 全局禁用 pip 进度条和缓存
ENV PIP_PROGRESS_BAR=off
ENV PIP_NO_CACHE_DIR=1

# 安装系统依赖
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ffmpeg libsndfile1 git wget && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 安装 Python 依赖
RUN pip install --no-cache-dir --progress-bar off \
    transformers>=4.45.0 \
    accelerate>=0.34.0 \
    soundfile \
    librosa \
    sentencepiece \
    protobuf \
    tiktoken \
    fastapi \
    "uvicorn[standard]" \
    python-multipart \
    pydantic

# 预下载模型（构建时可选，也可运行时自动下载）
# 如需预下载，取消注释以下行：
# RUN python -c "from transformers import AutoModelForCausalLM; AutoModelForCausalLM.from_pretrained('Qwen/Qwen2.5-Omni-7B', trust_remote_code=True)"

# 复制 API 服务器和启动脚本
COPY api_server_qwen3.py /app/api_server_qwen3.py
COPY start_qwen3.sh /app/start_qwen3.sh
RUN chmod +x /app/start_qwen3.sh

# 创建必要目录
RUN mkdir -p /app/prompts /app/outputs/api

# 环境变量
ENV QWEN3_TTS_HOST=0.0.0.0
ENV QWEN3_TTS_PORT=8000

# PyTorch 显存优化
ENV PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True,max_split_size_mb:512,garbage_collection_threshold:0.6

EXPOSE 8000

CMD ["/app/start_qwen3.sh"]
