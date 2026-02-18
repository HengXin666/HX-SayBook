# ============================================================
# LuxTTS (ZipVoice) 轻量级 TTS 镜像
# 基于 fangwaii/index-tts-2（已包含 PyTorch + CUDA 环境）
# 增量安装 ZipVoice 源码和依赖
# ============================================================
FROM docker.cnb.cool/fangwaii/index-tts-2

# 全局禁用 pip 进度条和缓存，避免子进程触发 Rich 线程限制
ENV PIP_PROGRESS_BAR=off
ENV PIP_NO_CACHE_DIR=1

# 安装 FFmpeg（torchcodec 运行时需要 libavutil / libavcodec / libavformat 等共享库）
# 构建环境存在线程限制，无法在线修复 GPG 密钥
# 方案：1) 清理旧缓存 2) 删除所有 apt 配置文件中的 Post-Invoke 脚本 3) 强制绕过 GPG 验证更新索引
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

# 工作目录
WORKDIR /app

# 下载 ZipVoice 源码
# 方案: 直接用 wget 从 GitHub 下载 zip 包，彻底绕开 git clone 的线程限制
RUN echo "=== 下载 ZipVoice 源码 ===" && \
    wget -q --show-progress -O /tmp/zipvoice.zip \
      "https://github.com/k2-fsa/ZipVoice/archive/refs/heads/master.zip" && \
    unzip -q /tmp/zipvoice.zip -d /app && \
    mv /app/ZipVoice-master /app/zipvoice && \
    rm /tmp/zipvoice.zip && \
    echo "=== ZipVoice 源码下载完成 ==="

WORKDIR /app/zipvoice

# 补丁：修复 add_punctuation 对 None/空字符串的处理
# ZipVoice 的 add_punctuation(text) 直接调用 text.strip() 和 text[-1]，
# 当 prompt_text 为 None 或 "" 时会崩溃（AttributeError / IndexError）
# 同时修复 generate_sentence 中对 prompt_text=None 的传递
RUN sed -i 's/^def add_punctuation(text):/def add_punctuation(text):\n    if text is None or (isinstance(text, str) and not text.strip()):\n        return text/' \
    /app/zipvoice/zipvoice/utils/infer.py && \
    echo "✅ 已补丁 add_punctuation: 空值防御"

# 安装 ZipVoice 依赖 + 安装包本身
# 1. 先安装 requirements.txt 中的依赖
# 2. 再用 pip install . 安装 zipvoice 包（使 python3 -m zipvoice.bin.xxx 可用）
# 注意：ZipVoice 正确的推理方式是 python3 -m zipvoice.bin.infer_zipvoice
RUN if [ -f requirements.txt ]; then \
      pip install --no-cache-dir --progress-bar off -r requirements.txt; \
    fi && \
    if [ -f pyproject.toml ] || [ -f setup.py ]; then \
      pip install --no-cache-dir --progress-bar off --no-build-isolation . || \
      pip install --no-cache-dir --progress-bar off . || \
      echo "⚠️ pip install . 失败，将依赖 PYTHONPATH 回退方案"; \
    fi
ENV PYTHONPATH=/app/zipvoice:${PYTHONPATH}

# 避免构建环境线程限制
ENV OPENBLAS_NUM_THREADS=1
ENV OMP_NUM_THREADS=1

# 安装 k2（必须用 --no-deps，防止 PyPI 上的 k2 把 PyTorch 2.6 降级到 1.13）
# k2-fsa 官方 CUDA wheel 页面可能没有匹配 torch 2.6 + cu124 的版本
# 所以从 PyPI 安装但跳过依赖，保护现有 PyTorch 版本
RUN pip install --no-cache-dir --progress-bar off --no-deps k2 \
    -f https://k2-fsa.github.io/k2/cuda.html || \
    pip install --no-cache-dir --progress-bar off --no-deps k2 || \
    echo "⚠️ k2 安装失败，跳过" && \
    pip install --no-cache-dir --progress-bar off --no-deps graphviz || true

# 修复 torchaudio 与 PyTorch 版本不兼容问题
# ZipVoice 或 k2 的依赖安装可能覆盖了基础镜像中匹配的 torchaudio 版本
# 必须从 PyTorch 官方源安装与当前 torch 版本严格匹配的 torchaudio
# 关键：torch.version.cuda 返回 "12.1" 格式，但 wheel 索引需要 "cu121" 格式
RUN TORCH_FULL_VER=$(python3 -c "import torch; print(torch.__version__)") && \
    TORCH_BASE_VER=$(python3 -c "import torch; print(torch.__version__.split('+')[0])") && \
    CUDA_TAG=$(python3 -c "import torch; v=torch.version.cuda; print('cu' + v.replace('.','')) if v else print('cpu')") && \
    echo "=== PyTorch 版本: $TORCH_FULL_VER, 基础版本: $TORCH_BASE_VER, CUDA 标签: $CUDA_TAG ===" && \
    pip uninstall -y torchaudio torchcodec 2>/dev/null; true && \
    echo "=== 从 PyTorch 官方源安装 torchaudio (index: $CUDA_TAG) ===" && \
    pip install --no-cache-dir --progress-bar off \
      "torchaudio==${TORCH_BASE_VER}" \
      --index-url "https://download.pytorch.org/whl/${CUDA_TAG}" && \
    echo "=== 验证 torchaudio 兼容性 ===" && \
    python3 -c "import torchaudio; print('torchaudio 版本:', torchaudio.__version__)" && \
    echo "=== torchaudio 安装验证通过 ==="

# 安装 torchcodec（torchaudio 新版本的音频解码后端）
RUN pip install --no-cache-dir --progress-bar off torchcodec || \
    echo "⚠️ torchcodec 安装失败，torchaudio.load() 可能不可用"

# 安装 API 服务器额外依赖（基础镜像可能已有部分，这里确保齐全）
# soundfile 作为 torchaudio 的备用后端，不依赖 FFmpeg
RUN pip install --no-cache-dir --progress-bar off \
    fastapi uvicorn[standard] python-multipart pydantic httpx soundfile

# 创建必要目录
RUN mkdir -p /app/zipvoice/prompts /app/zipvoice/outputs/api

# 复制 API 服务器和启动脚本
COPY api_server_lux.py /app/zipvoice/api_server_lux.py
COPY start_lux.sh /app/zipvoice/start_lux.sh
RUN chmod +x /app/zipvoice/start_lux.sh

# 环境变量：默认 8 个 worker 并发
ENV LUX_TTS_WORKERS=8
ENV LUX_TTS_HOST=0.0.0.0
ENV LUX_TTS_PORT=8000
ENV LUX_TTS_MODEL=zipvoice

# 确保 FFmpeg 共享库路径可被找到（torchcodec 依赖 libavutil.so 等）
ENV LD_LIBRARY_PATH=/usr/lib/x86_64-linux-gnu:/usr/local/lib:${LD_LIBRARY_PATH}

EXPOSE 8000
