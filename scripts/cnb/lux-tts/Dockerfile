# ============================================================
# LuxTTS (ZipVoice) 轻量级 TTS 镜像
# 基于 k2-fsa/ZipVoice，显存占用约 1GB，支持多并发
# ============================================================
FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV HF_ENDPOINT=https://huggingface.co

# 系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.10 python3.10-venv python3-pip \
    git wget curl ffmpeg libsndfile1 \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3.10 /usr/bin/python3 \
    && ln -sf /usr/bin/python3 /usr/bin/python

# pip 基础
RUN pip install --no-cache-dir --upgrade pip setuptools wheel

# 工作目录
WORKDIR /app

# 克隆 ZipVoice 仓库
RUN git clone https://github.com/k2-fsa/ZipVoice.git /app/zipvoice

WORKDIR /app/zipvoice

# 安装 ZipVoice 及其依赖
RUN pip install --no-cache-dir -e .

# 安装 PyTorch (CUDA 12.1)
RUN pip install --no-cache-dir \
    torch==2.5.1+cu121 torchaudio==2.5.1+cu121 \
    --index-url https://download.pytorch.org/whl/cu121

# 安装 k2 (与 PyTorch 2.5.1 + CUDA 12.1 匹配)
RUN pip install --no-cache-dir \
    k2==1.24.4.dev20250208+cuda12.1.torch2.5.1 \
    -f https://k2-fsa.github.io/k2/cuda.html || \
    echo "⚠️ k2 安装失败，尝试不带版本号安装" && \
    pip install --no-cache-dir k2

# 安装 API 服务器额外依赖
RUN pip install --no-cache-dir \
    fastapi uvicorn[standard] python-multipart pydantic httpx

# 预下载模型 (可选，可在运行时自动下载)
# RUN python3 -c "from zipvoice.zipvoice_infer import ZipVoiceTTS; ZipVoiceTTS('zipvoice')"

# 创建必要目录
RUN mkdir -p /app/zipvoice/prompts /app/zipvoice/outputs/api

# 环境变量：默认 8 个 worker 并发
ENV LUX_TTS_WORKERS=8
ENV LUX_TTS_HOST=0.0.0.0
ENV LUX_TTS_PORT=8000
ENV LUX_TTS_MODEL=zipvoice

EXPOSE 8000

# 复制 API 服务器和启动脚本
COPY api_server_lux.py /app/zipvoice/api_server_lux.py
COPY start_lux.sh /app/zipvoice/start_lux.sh
RUN chmod +x /app/zipvoice/start_lux.sh

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD curl -f http://localhost:8000/ || exit 1

CMD ["/app/zipvoice/start_lux.sh"]
