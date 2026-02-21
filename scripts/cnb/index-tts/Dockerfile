# ============================================================
# Index-TTS 2.5 日语增强镜像
# 基于 fangwaii/index-tts-2，在构建时预下载日语模型
# 2.5 改进: Zipformer S2M / 25Hz 语义编码 / RTF 0.119
# ============================================================
FROM docker.cnb.cool/fangwaii/index-tts-2

# 工作目录（镜像内 index-tts 代码位置）
WORKDIR /app/index-tts

# 安装 pykakasi（日语分词）
RUN pip install --no-cache-dir --progress-bar off pykakasi

# 下载日语模型到 checkpoints/ja 目录
# 来源: https://huggingface.co/Jmica/IndexTTS-2-Japanese
# 方案: 直接用 wget 从 HuggingFace CDN 下载，彻底绕开 Python 生态的线程限制
#   - japanese_bpe.model  (428 KB)  → 重命名为 bpe.model
#   - model_jp_163000.pth (3.48 GB) → 重命名为 gpt.pth
#   - config.yaml         (3 KB)    → 保持不变
ENV HF_REPO_URL=https://huggingface.co/Jmica/IndexTTS-2-Japanese/resolve/main

RUN mkdir -p checkpoints/ja && \
    echo "=== [1/3] Downloading bpe.model ===" && \
    wget -q --show-progress -O checkpoints/ja/bpe.model \
      "${HF_REPO_URL}/japanese_bpe.model" && \
    echo "=== [2/3] Downloading gpt.pth (约 3.5 GB，请耐心等待) ===" && \
    wget -q --show-progress -O checkpoints/ja/gpt.pth \
      "${HF_REPO_URL}/model_jp_163000.pth" && \
    echo "=== [3/3] Downloading config.yaml ===" && \
    wget -q --show-progress -O checkpoints/ja/config.yaml \
      "${HF_REPO_URL}/config.yaml" && \
    echo "=== All Japanese model files downloaded ==="

# 创建符号链接：日语 config.yaml 中引用了多个与中文共用的文件/目录，
# 它们只存在于 checkpoints/ 中，需要在 checkpoints/ja/ 下创建链接指向上层
RUN cd checkpoints/ja && \
    ln -sf ../qwen0.6bemo4-merge . && \
    ln -sf ../s2mel.pth . && \
    ln -sf ../wav2vec2bert_stats.pt . && \
    ln -sf ../feat1.pt . && \
    ln -sf ../feat2.pt . && \
    echo "✅ 日语共用文件符号链接创建完成"

# 验证日语模型文件完整性
RUN echo "=== 验证日语模型文件 ===" && \
    ls -lh checkpoints/ja/bpe.model && \
    ls -lh checkpoints/ja/gpt.pth && \
    ls -lh checkpoints/ja/config.yaml && \
    ls -lh checkpoints/ja/s2mel.pth && \
    ls -lh checkpoints/ja/wav2vec2bert_stats.pt && \
    ls -lh checkpoints/ja/feat1.pt && \
    ls -lh checkpoints/ja/feat2.pt && \
    ls -ld checkpoints/ja/qwen0.6bemo4-merge && \
    echo "✅ 日语模型文件验证通过"

# 确保目录存在
RUN mkdir -p prompts outputs/api

EXPOSE 8000
