# ============================================================
# Fish-Speech 1.5 极速模式镜像
# 单说话人 + 极速推理 + 显存 ≥4GB
# ============================================================
FROM pytorch/pytorch:2.4.0-cuda12.4-cudnn9-runtime

ENV PIP_PROGRESS_BAR=off
ENV PIP_NO_CACHE_DIR=1

# 安装系统依赖
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ffmpeg libsndfile1 git wget cmake && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ============================================================
# 安装 Fish-Speech
# ============================================================
RUN git clone https://github.com/fishaudio/fish-speech.git /app/fish-speech && \
    cd /app/fish-speech && \
    pip install --no-cache-dir --progress-bar off -e . && \
    echo "✅ Fish-Speech 安装完成"

# 下载 Fish-Speech 1.5 模型
RUN huggingface-cli download fishaudio/fish-speech-1.5 \
    --local-dir /app/fish-speech/checkpoints/fish-speech-1.5 || \
    echo "⚠️ 模型下载失败，请手动下载"

# 安装 API 适配层依赖
RUN pip install --no-cache-dir --progress-bar off \
    fastapi "uvicorn[standard]" python-multipart pydantic \
    ormsgpack httpx soundfile

# 复制 API 服务器和启动脚本
COPY api_server_fish.py /app/api_server_fish.py
COPY start_fish.sh /app/start_fish.sh
RUN chmod +x /app/start_fish.sh

# 创建必要目录
RUN mkdir -p /app/prompts /app/outputs/api

# 环境变量
ENV FISH_TTS_HOST=0.0.0.0
ENV FISH_TTS_PORT=8000
ENV FISH_TTS_MODE=proxy
ENV FISH_API_URL=http://localhost:8080

# PyTorch 显存优化
ENV PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True,max_split_size_mb:256

EXPOSE 8000 8080

CMD ["/app/start_fish.sh"]
