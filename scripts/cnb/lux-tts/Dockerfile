# ============================================================
# LuxTTS 轻量级 TTS 镜像
# 使用 LuxTTS 官方源码 (ysharma3501/LuxTTS)
# 基于 fangwaii/index-tts-2（已包含 PyTorch + CUDA 环境）
# ============================================================
FROM docker.cnb.cool/fangwaii/index-tts-2

# 全局禁用 pip 进度条和缓存
ENV PIP_PROGRESS_BAR=off
ENV PIP_NO_CACHE_DIR=1

# 安装 FFmpeg（音频处理需要）
RUN find /etc/apt/apt.conf.d -type f -exec sed -i '/Post-Invoke/d' {} \; && \
    rm -rf /var/lib/apt/lists/* /var/cache/apt/*.bin && \
    echo 'Acquire::AllowInsecureRepositories "true";' > /etc/apt/apt.conf.d/99allow-insecure && \
    echo 'Acquire::AllowDowngradeToInsecureRepositories "true";' >> /etc/apt/apt.conf.d/99allow-insecure && \
    echo 'APT::Get::AllowUnauthenticated "true";' >> /etc/apt/apt.conf.d/99allow-insecure && \
    echo 'Acquire::Check-Valid-Until "false";' >> /etc/apt/apt.conf.d/99allow-insecure && \
    rm -f /etc/apt/sources.list.d/cuda*.list && \
    apt-get update --allow-insecure-repositories && \
    apt-get install -y --allow-unauthenticated --no-install-recommends \
      ffmpeg libavcodec-dev libavformat-dev libavutil-dev && \
    rm -f /etc/apt/apt.conf.d/99allow-insecure && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ============================================================
# 复制本地已下载的 LuxTTS 源码和 LinaCodec 源码
# （构建前需先 git clone 到 ./LuxTTS 和 ./LinaCodec）
# ============================================================
COPY LuxTTS/ /app/luxtts/
COPY LinaCodec/ /app/LinaCodec/

WORKDIR /app/luxtts

# 避免构建环境线程限制
ENV OPENBLAS_NUM_THREADS=1
ENV OMP_NUM_THREADS=1

# ============================================================
# 安装 LuxTTS 依赖（离线友好：去掉 git+ 和 --find-links）
# 1. 先从本地安装 LinaCodec
# 2. 再安装修改后的 requirements.txt（去掉 git+LinaCodec 行和 --find-links 行）
# 3. 单独安装 piper_phonemize（尝试 pip 默认源）
# ============================================================
RUN pip install --no-cache-dir --progress-bar off /app/LinaCodec/

# 生成离线版 requirements.txt（去掉 git+ 行和 --find-links 行）
RUN sed -e '/^git+/d' -e '/^--find-links/d' requirements.txt > /tmp/requirements_offline.txt && \
    pip install --no-cache-dir --progress-bar off -r /tmp/requirements_offline.txt && \
    rm /tmp/requirements_offline.txt

# 单独尝试安装 piper_phonemize（可能需要特殊源）
RUN pip install --no-cache-dir --progress-bar off piper_phonemize || \
    pip install --no-cache-dir --progress-bar off \
      --find-links https://k2-fsa.github.io/icefall/piper_phonemize.html \
      piper_phonemize || \
    echo "⚠️ piper_phonemize 安装失败，可能影响部分语言支持"

# 安装 LuxTTS 包本身（使 from zipvoice.luxvoice import LuxTTS 可用）
RUN pip install --no-cache-dir --progress-bar off --no-build-isolation . || \
    pip install --no-cache-dir --progress-bar off . || \
    echo "⚠️ pip install . 失败，将依赖 PYTHONPATH"
ENV PYTHONPATH=/app/luxtts:${PYTHONPATH}

# 修复 torchaudio 与 PyTorch 版本不兼容问题
RUN TORCH_BASE_VER=$(python3 -c "import torch; print(torch.__version__.split('+')[0])") && \
    CUDA_TAG=$(python3 -c "import torch; v=torch.version.cuda; print('cu' + v.replace('.','')) if v else print('cpu')") && \
    echo "=== PyTorch: $TORCH_BASE_VER, CUDA: $CUDA_TAG ===" && \
    pip uninstall -y torchaudio torchcodec 2>/dev/null; true && \
    pip install --no-cache-dir --progress-bar off \
      "torchaudio==${TORCH_BASE_VER}" \
      --index-url "https://download.pytorch.org/whl/${CUDA_TAG}" && \
    python3 -c "import torchaudio; print('torchaudio:', torchaudio.__version__)" && \
    echo "=== torchaudio 安装完成 ==="

# 安装 API 服务器额外依赖
RUN pip install --no-cache-dir --progress-bar off \
    fastapi uvicorn[standard] python-multipart pydantic soundfile

# 创建必要目录
RUN mkdir -p /app/luxtts/prompts /app/luxtts/outputs/api

# 复制 API 服务器和启动脚本
COPY api_server_lux.py /app/luxtts/api_server_lux.py
COPY start_lux.sh /app/luxtts/start_lux.sh
RUN chmod +x /app/luxtts/start_lux.sh

# 环境变量
ENV LUX_TTS_WORKERS=1
ENV LUX_TTS_HOST=0.0.0.0
ENV LUX_TTS_PORT=8000

# PyTorch 显存优化
ENV PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True,max_split_size_mb:512,garbage_collection_threshold:0.6

# FFmpeg 共享库路径
ENV LD_LIBRARY_PATH=/usr/lib/x86_64-linux-gnu:/usr/local/lib:${LD_LIBRARY_PATH}

EXPOSE 8000
