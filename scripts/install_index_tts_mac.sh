#!/usr/bin/env bash
# ============================================================
# Index-TTS 一键安装脚本 (macOS Apple Silicon 专用)
# 支持 M1/M2/M3/M4 芯片，使用 MPS 后端加速
# ============================================================
set -e

echo "========================================"
echo "  Index-TTS 安装向导 (macOS 版)"
echo "========================================"

INSTALL_DIR="$(cd "$(dirname "$0")" && pwd)/index-tts"

# 检测 macOS 环境
detect_mac() {
    if [[ "$OSTYPE" != "darwin"* ]]; then
        echo "❌ 此脚本仅适用于 macOS 系统"
        echo "   如果你使用 Linux/Windows，请运行 install_index_tts.sh"
        exit 1
    fi

    # 检测芯片类型
    local chip
    chip=$(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo "Unknown")
    echo "📋 系统: macOS $(sw_vers -productVersion 2>/dev/null || echo '')"
    echo "🖥️ 芯片: $chip"

    # 检测内存
    local mem_bytes
    mem_bytes=$(sysctl -n hw.memsize 2>/dev/null || echo 0)
    local mem_gb=$((mem_bytes / 1073741824))
    echo "💾 内存: ${mem_gb}GB"

    if [[ "$mem_gb" -lt 8 ]]; then
        echo "⚠️ 警告: 内存不足 8GB，运行可能会比较吃力"
    fi
}

# 检查是否为 Apple Silicon (支持 MPS)
USE_MPS=false
check_mps() {
    local arch
    arch=$(uname -m)
    if [[ "$arch" == "arm64" ]]; then
        echo "✅ 检测到 Apple Silicon (arm64)，将使用 MPS 加速"
        USE_MPS=true
    else
        echo "⚠️ 检测到 Intel Mac (x86_64)，将使用 CPU 模式"
        echo "   Intel Mac 无 MPS 加速，推理速度较慢"
        USE_MPS=false
    fi
}

# 安装 Homebrew（如果未安装）
ensure_homebrew() {
    if ! command -v brew &> /dev/null; then
        echo "🍺 未检测到 Homebrew，正在安装..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

        # Apple Silicon 的 brew 路径
        if [[ -f "/opt/homebrew/bin/brew" ]]; then
            eval "$(/opt/homebrew/bin/brew shellenv)"
        fi
    else
        echo "✅ Homebrew 已安装"
    fi
}

# 安装系统依赖
install_system_deps() {
    echo "📦 安装 macOS 系统依赖..."
    ensure_homebrew

    # 安装必需依赖
    local deps=(python@3.11 git ffmpeg)
    for dep in "${deps[@]}"; do
        if brew list "$dep" &>/dev/null; then
            echo "   ✅ $dep 已安装"
        else
            echo "   📥 安装 $dep..."
            brew install "$dep"
        fi
    done
}

# 克隆/更新 Index-TTS
setup_index_tts() {
    if [[ -d "$INSTALL_DIR" ]]; then
        echo "📂 Index-TTS 目录已存在，更新中..."
        cd "$INSTALL_DIR"
        git pull || true
    else
        echo "📥 克隆 Index-TTS..."
        git clone https://github.com/index-tts/index-tts.git "$INSTALL_DIR"
        cd "$INSTALL_DIR"
    fi
}

# 安装 Python 依赖
install_python_deps() {
    echo "📦 安装 Python 依赖..."
    cd "$INSTALL_DIR"

    if command -v uv &> /dev/null; then
        echo "   使用 uv 管理环境..."

        # macOS: 不需要 CUDA，直接安装默认版本（包含 MPS 支持）
        echo "🍎 安装 macOS 版依赖 (MPS/CPU)..."
        uv sync --index-strategy unsafe-best-match

        # 安装 API Server 额外依赖
        uv pip install fastapi uvicorn[standard] python-multipart
    else
        echo "   使用 pip 管理环境..."
        python3 -m venv venv
        source venv/bin/activate

        # macOS 默认 PyTorch 已包含 MPS 支持，无需指定 CUDA
        echo "🍎 安装 PyTorch (含 MPS 支持)..."
        pip install torch torchvision torchaudio

        pip install -r requirements.txt 2>/dev/null || pip install .
        pip install fastapi uvicorn[standard] python-multipart
    fi
}

# 激活 index-tts 的虚拟环境
activate_venv() {
    if [[ -d "$INSTALL_DIR/.venv" ]]; then
        source "$INSTALL_DIR/.venv/bin/activate"
    elif [[ -d "$INSTALL_DIR/venv" ]]; then
        source "$INSTALL_DIR/venv/bin/activate"
    fi
}

# 获取 venv 中 python 的路径
get_venv_python() {
    if [[ -f "$INSTALL_DIR/.venv/bin/python" ]]; then
        echo "$INSTALL_DIR/.venv/bin/python"
    elif [[ -f "$INSTALL_DIR/venv/bin/python" ]]; then
        echo "$INSTALL_DIR/venv/bin/python"
    else
        echo "python3"
    fi
}

# 获取 venv 中 pip/uv pip 安装命令前缀
venv_pip_install() {
    local venv_python
    venv_python=$(get_venv_python)
    if command -v uv &>/dev/null; then
        uv pip install --python "$venv_python" "$@"
    else
        "$venv_python" -m pip install "$@"
    fi
}

# 安装下载工具（huggingface-cli 或 modelscope）
ensure_download_tool() {
    local tool="$1"
    local venv_python
    venv_python=$(get_venv_python)
    if [[ "$tool" == "modelscope" ]]; then
        if ! "$venv_python" -c "import modelscope" &>/dev/null 2>&1; then
            echo "   📦 安装 modelscope..."
            venv_pip_install modelscope
        fi
    elif [[ "$tool" == "huggingface" ]]; then
        local hf_cmd=""
        for bin_dir in "$INSTALL_DIR/.venv/bin" "$INSTALL_DIR/venv/bin"; do
            if [[ -f "$bin_dir/hf" ]]; then
                hf_cmd="$bin_dir/hf"
                break
            elif [[ -f "$bin_dir/huggingface-cli" ]]; then
                hf_cmd="$bin_dir/huggingface-cli"
                break
            fi
        done
        if [[ -z "$hf_cmd" ]]; then
            echo "   📦 安装 huggingface_hub[cli]..."
            venv_pip_install "huggingface_hub[cli]"
        fi
    fi
}

# 通过 ModelScope 下载模型（国内推荐）
download_via_modelscope() {
    local model_dir="$1"
    local venv_python
    venv_python=$(get_venv_python)
    echo "   🇨🇳 使用 ModelScope 下载模型（国内源）..."
    ensure_download_tool "modelscope"

    local ms_cli=""
    for bin_dir in "$INSTALL_DIR/.venv/bin" "$INSTALL_DIR/venv/bin"; do
        if [[ -f "$bin_dir/modelscope" ]]; then
            ms_cli="$bin_dir/modelscope"
            break
        fi
    done

    if [[ -n "$ms_cli" ]]; then
        echo "   📦 使用 modelscope CLI 下载..."
        "$ms_cli" download --model IndexTeam/IndexTTS-2 --local_dir "$model_dir"
    else
        echo "   📦 使用 modelscope Python API 下载..."
        "$venv_python" -c "
from modelscope import snapshot_download
snapshot_download(
    'IndexTeam/IndexTTS-2',
    local_dir='$model_dir'
)
print('✅ ModelScope 下载完成')
"
    fi
}

# 通过 HuggingFace 下载模型
download_via_huggingface() {
    local model_dir="$1"
    echo "   🌐 使用 HuggingFace 下载模型..."
    ensure_download_tool "huggingface"

    if [[ -n "$HF_ENDPOINT" ]]; then
        echo "   🔗 使用 HuggingFace 镜像: $HF_ENDPOINT"
    fi

    local hf_cmd=""
    for bin_dir in "$INSTALL_DIR/.venv/bin" "$INSTALL_DIR/venv/bin"; do
        if [[ -f "$bin_dir/hf" ]]; then
            hf_cmd="$bin_dir/hf"
            break
        elif [[ -f "$bin_dir/huggingface-cli" ]]; then
            hf_cmd="$bin_dir/huggingface-cli"
            break
        fi
    done

    if [[ -z "$hf_cmd" ]]; then
        echo "   ❌ 找不到 hf 或 huggingface-cli 命令"
        return 1
    fi

    "$hf_cmd" download IndexTeam/IndexTTS-2 \
        --local-dir "$model_dir" \
        --exclude "*.md" "*.txt" "*.png" "*.mp4"
}

# 通过 HuggingFace 镜像站下载模型（国内备选）
download_via_hf_mirror() {
    local model_dir="$1"
    echo "   🔗 使用 HuggingFace 镜像站（hf-mirror.com）下载模型..."
    HF_ENDPOINT="https://hf-mirror.com" download_via_huggingface "$model_dir"
}

# 通过 wget 直接下载日语模型（绕开 Python 线程限制）
# 来源: https://huggingface.co/Jmica/IndexTTS-2-Japanese
# 文件映射: japanese_bpe.model → bpe.model, model_jp_163000.pth → gpt.pth
download_ja_via_wget() {
    local model_dir="$1"
    local hf_base="$2"  # HuggingFace 基础 URL
    
    echo "   📥 使用 wget 下载日语模型..."
    mkdir -p "$model_dir"
    
    # 下载 bpe.model (原文件名: japanese_bpe.model, 约 428 KB)
    echo "   === [1/3] 下载 bpe.model ===" 
    if ! wget -q --show-progress -O "$model_dir/bpe.model" \
        "${hf_base}/Jmica/IndexTTS-2-Japanese/resolve/main/japanese_bpe.model"; then
        echo "   ❌ bpe.model 下载失败"
        return 1
    fi
    
    # 下载 gpt.pth (原文件名: model_jp_163000.pth, 约 3.5 GB)
    echo "   === [2/3] 下载 gpt.pth (约 3.5 GB，请耐心等待) ==="
    if ! wget -q --show-progress -O "$model_dir/gpt.pth" \
        "${hf_base}/Jmica/IndexTTS-2-Japanese/resolve/main/model_jp_163000.pth"; then
        echo "   ❌ gpt.pth 下载失败"
        return 1
    fi
    
    # 下载 config.yaml (约 3 KB)
    echo "   === [3/3] 下载 config.yaml ==="
    if ! wget -q --show-progress -O "$model_dir/config.yaml" \
        "${hf_base}/Jmica/IndexTTS-2-Japanese/resolve/main/config.yaml"; then
        echo "   ❌ config.yaml 下载失败"
        return 1
    fi
    
    echo "   ✅ 日语模型文件下载完成"
}

# 通过 HuggingFace 下载日语模型（备用方案）
download_ja_via_huggingface() {
    local model_dir="$1"
    echo "   🌐 使用 HuggingFace 下载日语模型..."
    ensure_download_tool "huggingface"

    if [[ -n "$HF_ENDPOINT" ]]; then
        echo "   🔗 使用 HuggingFace 镜像: $HF_ENDPOINT"
    fi

    local hf_cmd=""
    for bin_dir in "$INSTALL_DIR/.venv/bin" "$INSTALL_DIR/venv/bin"; do
        if [[ -f "$bin_dir/hf" ]]; then
            hf_cmd="$bin_dir/hf"
            break
        elif [[ -f "$bin_dir/huggingface-cli" ]]; then
            hf_cmd="$bin_dir/huggingface-cli"
            break
        fi
    done

    if [[ -z "$hf_cmd" ]]; then
        echo "   ❌ 找不到 hf 或 huggingface-cli 命令"
        return 1
    fi

    # 下载到临时目录，然后重命名
    local tmp_dir="$model_dir.tmp"
    mkdir -p "$tmp_dir"
    
    if ! "$hf_cmd" download Jmica/IndexTTS-2-Japanese \
        --local-dir "$tmp_dir" \
        --exclude "*.md" "*.txt" "*.png" "*.mp4"; then
        rm -rf "$tmp_dir"
        return 1
    fi
    
    # 重命名文件
    mkdir -p "$model_dir"
    [[ -f "$tmp_dir/japanese_bpe.model" ]] && mv "$tmp_dir/japanese_bpe.model" "$model_dir/bpe.model"
    [[ -f "$tmp_dir/model_jp_163000.pth" ]] && mv "$tmp_dir/model_jp_163000.pth" "$model_dir/gpt.pth"
    [[ -f "$tmp_dir/config.yaml" ]] && mv "$tmp_dir/config.yaml" "$model_dir/config.yaml"
    rm -rf "$tmp_dir"
    
    echo "   ✅ 日语模型文件下载完成"
}

# 通过 HuggingFace 镜像站下载日语模型（国内备选）
download_ja_via_hf_mirror() {
    local model_dir="$1"
    echo "   🔗 使用 HuggingFace 镜像站（hf-mirror.com）下载日语模型..."
    # 优先使用 wget 方式（更快更稳定）
    if command -v wget &>/dev/null; then
        download_ja_via_wget "$model_dir" "https://hf-mirror.com"
    else
        HF_ENDPOINT="https://hf-mirror.com" download_ja_via_huggingface "$model_dir"
    fi
}

# 下载模型
download_models() {
    echo ""
    echo "📥 检查模型文件..."
    cd "$INSTALL_DIR"

    MODEL_DIR="$INSTALL_DIR/checkpoints"
    mkdir -p "$MODEL_DIR"

    # 需要的模型文件列表
    REQUIRED_FILES=("bpe.model" "gpt.pth" "config.yaml" "s2mel.pth" "wav2vec2bert_stats.pt" "feat1.pt" "feat2.pt")
    # 需要的模型目录列表
    REQUIRED_DIRS=("qwen0.6bemo4-merge")
    MISSING=false
    MISSING_LIST=()

    for f in "${REQUIRED_FILES[@]}"; do
        if [[ ! -f "$MODEL_DIR/$f" ]]; then
            echo "   ⚠️ 缺少: $f"
            MISSING=true
            MISSING_LIST+=("$f")
        else
            echo "   ✅ 已存在: $f"
        fi
    done

    for d in "${REQUIRED_DIRS[@]}"; do
        if [[ ! -d "$MODEL_DIR/$d" ]]; then
            echo "   ⚠️ 缺少目录: $d/"
            MISSING=true
            MISSING_LIST+=("$d/")
        else
            echo "   ✅ 已存在: $d/"
        fi
    done

    if [[ "$MISSING" == false ]]; then
        echo "   ✅ 所有模型文件已存在，跳过下载"
        return 0
    fi

    echo ""
    echo "📦 模型文件约 2.5GB，需要下载以下文件："
    for f in "${MISSING_LIST[@]}"; do
        echo "   - $f"
    done
    echo ""
    echo "请选择下载方式："
    echo "  1) ModelScope（国内推荐，速度快）"
    echo "  2) HuggingFace 镜像站（hf-mirror.com，国内备选）"
    echo "  3) HuggingFace 官方（需要科学上网）"
    echo "  4) 跳过下载（稍后手动下载）"
    echo ""
    read -r -p "请输入选项 [1-4]（默认 1）: " DOWNLOAD_CHOICE
    DOWNLOAD_CHOICE=${DOWNLOAD_CHOICE:-1}

    local DOWNLOAD_SUCCESS=false

    case "$DOWNLOAD_CHOICE" in
        1)
            download_via_modelscope "$MODEL_DIR" && DOWNLOAD_SUCCESS=true || {
                echo "   ❌ ModelScope 下载失败，自动尝试 HuggingFace 镜像站..."
                download_via_hf_mirror "$MODEL_DIR" && DOWNLOAD_SUCCESS=true || true
            }
            ;;
        2)
            download_via_hf_mirror "$MODEL_DIR" && DOWNLOAD_SUCCESS=true || {
                echo "   ❌ HuggingFace 镜像站下载失败，自动尝试 ModelScope..."
                download_via_modelscope "$MODEL_DIR" && DOWNLOAD_SUCCESS=true || true
            }
            ;;
        3)
            download_via_huggingface "$MODEL_DIR" && DOWNLOAD_SUCCESS=true || {
                echo "   ❌ HuggingFace 下载失败"
            }
            ;;
        4)
            echo "   ⏭️ 已跳过模型下载"
            echo ""
            print_manual_download_help "$MODEL_DIR"
            return 0
            ;;
        *)
            echo "   ⚠️ 无效选项，跳过下载"
            return 0
            ;;
    esac

    # 最终检查
    echo ""
    echo "📋 模型文件最终检查："
    STILL_MISSING=false
    for f in "${REQUIRED_FILES[@]}"; do
        if [[ ! -f "$MODEL_DIR/$f" ]]; then
            echo "   ❌ 缺少: $f"
            STILL_MISSING=true
        else
            echo "   ✅ 已存在: $f"
        fi
    done
    for d in "${REQUIRED_DIRS[@]}"; do
        if [[ ! -d "$MODEL_DIR/$d" ]]; then
            echo "   ❌ 缺少目录: $d/"
            STILL_MISSING=true
        else
            echo "   ✅ 已存在: $d/"
        fi
    done

    if [[ "$STILL_MISSING" == true ]]; then
        echo ""
        print_manual_download_help "$MODEL_DIR"
    else
        echo ""
        echo "   🎉 所有中文模型文件下载完成！"
    fi

    # ====== 日语模型下载 ======
    download_ja_models
}

# 创建日语模型的符号链接（引用中文模型目录中的共用文件）
create_ja_symlinks() {
    local ja_dir="$1"
    local checkpoints_dir
    checkpoints_dir=$(dirname "$ja_dir")
    
    echo "   🔗 创建日语模型共用文件符号链接..."
    cd "$ja_dir"
    
    # 日语 config.yaml 中引用了多个与中文共用的文件/目录
    # 它们只存在于 checkpoints/ 中，需要在 checkpoints/ja/ 下创建链接指向上层
    local shared_items=("qwen0.6bemo4-merge" "s2mel.pth" "wav2vec2bert_stats.pt" "feat1.pt" "feat2.pt")
    
    for item in "${shared_items[@]}"; do
        if [[ -e "../$item" ]]; then
            # 删除已存在的链接/文件
            [[ -L "$item" || -e "$item" ]] && rm -rf "$item"
            ln -sf "../$item" .
            echo "      ✅ $item → ../$item"
        else
            echo "      ⚠️ 共用文件不存在，跳过: $item"
        fi
    done
    
    echo "   ✅ 符号链接创建完成"
}

# 安装 pykakasi（日语分词依赖）
install_pykakasi() {
    echo "   📦 安装 pykakasi（日语分词）..."
    venv_pip_install pykakasi
}

# 下载日语模型（可选）
download_ja_models() {
    echo ""
    echo "📥 检查日语模型文件..."
    cd "$INSTALL_DIR"

    JA_MODEL_DIR="$INSTALL_DIR/checkpoints/ja"
    mkdir -p "$JA_MODEL_DIR"

    JA_REQUIRED_FILES=("bpe.model" "gpt.pth" "config.yaml")
    JA_MISSING=false
    JA_MISSING_LIST=()

    for f in "${JA_REQUIRED_FILES[@]}"; do
        if [[ ! -f "$JA_MODEL_DIR/$f" ]]; then
            echo "   ⚠️ 缺少: $f"
            JA_MISSING=true
            JA_MISSING_LIST+=("$f")
        else
            echo "   ✅ 已存在: $f"
        fi
    done

    if [[ "$JA_MISSING" == false ]]; then
        echo "   ✅ 所有日语模型文件已存在，跳过下载"
        # 仍然需要确保符号链接存在
        create_ja_symlinks "$JA_MODEL_DIR"
        # 安装 pykakasi
        install_pykakasi
        return 0
    fi

    echo ""
    echo "🇯🇵 是否下载日语 TTS 模型？（用于日语语音合成）"
    echo "   模型来源: HuggingFace Jmica/IndexTTS-2-Japanese"
    echo "   缺少的文件:"
    for f in "${JA_MISSING_LIST[@]}"; do
        echo "     - $f"
    done
    echo ""
    echo "请选择："
    echo "  1) wget 直接下载（国内推荐，速度快无线程限制）"
    echo "  2) HuggingFace CLI 下载（镜像站）"
    echo "  3) HuggingFace CLI 下载（官方，需要科学上网）"
    echo "  4) 跳过日语模型下载"
    echo ""
    read -r -p "请输入选项 [1-4]（默认 1）: " JA_CHOICE
    JA_CHOICE=${JA_CHOICE:-1}

    case "$JA_CHOICE" in
        1)
            # 优先使用 wget 从镜像站下载
            if command -v wget &>/dev/null; then
                download_ja_via_wget "$JA_MODEL_DIR" "https://hf-mirror.com" || {
                    echo "   ❌ 镜像站下载失败，尝试 HuggingFace 官方..."
                    download_ja_via_wget "$JA_MODEL_DIR" "https://huggingface.co" || true
                }
            else
                echo "   ⚠️ 未安装 wget，尝试使用 HuggingFace CLI..."
                download_ja_via_hf_mirror "$JA_MODEL_DIR" || {
                    echo "   ❌ HuggingFace 镜像站下载失败，尝试官方..."
                    download_ja_via_huggingface "$JA_MODEL_DIR" || true
                }
            fi
            ;;
        2)
            download_ja_via_hf_mirror "$JA_MODEL_DIR" || {
                echo "   ❌ HuggingFace 镜像站下载失败，自动尝试 HuggingFace 官方..."
                download_ja_via_huggingface "$JA_MODEL_DIR" || true
            }
            ;;
        3)
            download_ja_via_huggingface "$JA_MODEL_DIR" || {
                echo "   ❌ HuggingFace 下载失败"
            }
            ;;
        4)
            echo "   ⏭️ 已跳过日语模型下载"
            echo ""
            print_ja_manual_download_help "$JA_MODEL_DIR"
            return 0
            ;;
        *)
            echo "   ⚠️ 无效选项，跳过日语模型下载"
            return 0
            ;;
    esac

    # 最终检查日语模型
    echo ""
    echo "📋 日语模型文件最终检查："
    JA_STILL_MISSING=false
    for f in "${JA_REQUIRED_FILES[@]}"; do
        if [[ ! -f "$JA_MODEL_DIR/$f" ]]; then
            echo "   ❌ 缺少: $f"
            JA_STILL_MISSING=true
        else
            echo "   ✅ 已存在: $f"
        fi
    done

    if [[ "$JA_STILL_MISSING" == true ]]; then
        echo ""
        print_ja_manual_download_help "$JA_MODEL_DIR"
    else
        echo ""
        echo "   🎉 日语模型文件下载完成！"
        # 创建符号链接
        create_ja_symlinks "$JA_MODEL_DIR"
        # 安装 pykakasi
        install_pykakasi
    fi
}

# 打印手动下载帮助信息
print_manual_download_help() {
    local model_dir="$1"
    echo "⚠️ 部分模型文件缺失，请手动下载到: $model_dir"
    echo ""
    echo "   方式1（国内推荐 - ModelScope）:"
    echo "     pip install modelscope"
    echo "     modelscope download --model IndexTeam/IndexTTS-2 --local_dir $model_dir"
    echo ""
    echo "   方式2（HuggingFace 镜像站）:"
    echo "     pip install huggingface_hub[cli]"
    echo "     HF_ENDPOINT=https://hf-mirror.com hf download IndexTeam/IndexTTS-2 --local-dir $model_dir"
    echo ""
    echo "   方式3（HuggingFace 官方）:"
    echo "     pip install huggingface_hub[cli]"
    echo "     hf download IndexTeam/IndexTTS-2 --local-dir $model_dir"
    echo ""
}

# 打印日语模型手动下载帮助信息
print_ja_manual_download_help() {
    local model_dir="$1"
    echo "⚠️ 日语模型文件缺失，请手动下载到: $model_dir"
    echo ""
    echo "   文件映射（原文件名 → 保存文件名）："
    echo "     japanese_bpe.model  → bpe.model"
    echo "     model_jp_163000.pth → gpt.pth"
    echo "     config.yaml         → config.yaml"
    echo ""
    echo "   方式1（wget 直接下载，推荐）："
    echo "     mkdir -p $model_dir"
    echo "     wget -O $model_dir/bpe.model https://hf-mirror.com/Jmica/IndexTTS-2-Japanese/resolve/main/japanese_bpe.model"
    echo "     wget -O $model_dir/gpt.pth https://hf-mirror.com/Jmica/IndexTTS-2-Japanese/resolve/main/model_jp_163000.pth"
    echo "     wget -O $model_dir/config.yaml https://hf-mirror.com/Jmica/IndexTTS-2-Japanese/resolve/main/config.yaml"
    echo ""
    echo "   方式2（HuggingFace CLI）："
    echo "     pip install huggingface_hub[cli]"
    echo "     HF_ENDPOINT=https://hf-mirror.com hf download Jmica/IndexTTS-2-Japanese --local-dir $model_dir.tmp"
    echo "     mv $model_dir.tmp/japanese_bpe.model $model_dir/bpe.model"
    echo "     mv $model_dir.tmp/model_jp_163000.pth $model_dir/gpt.pth"
    echo "     mv $model_dir.tmp/config.yaml $model_dir/config.yaml"
    echo ""
    echo "   方式3（HuggingFace 官方）："
    echo "     将上述 hf-mirror.com 替换为 huggingface.co"
    echo ""
    echo "   下载完成后，创建符号链接："
    echo "     cd $model_dir"
    echo "     ln -sf ../qwen0.6bemo4-merge ."
    echo "     ln -sf ../s2mel.pth ."
    echo "     ln -sf ../wav2vec2bert_stats.pt ."
    echo "     ln -sf ../feat1.pt ."
    echo "     ln -sf ../feat2.pt ."
    echo ""
    echo "   安装日语分词依赖："
    echo "     pip install pykakasi"
    echo ""
}

# 创建启动脚本（macOS 专用）
create_start_script() {
    cat > "$INSTALL_DIR/start_tts_server.sh" << 'EOF'
#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
if [[ -d ".venv" ]]; then
    source .venv/bin/activate
elif [[ -d "venv" ]]; then
    source venv/bin/activate
fi

# macOS MPS 支持：允许不支持的 MPS 算子回退到 CPU
export PYTORCH_ENABLE_MPS_FALLBACK=1

# 检测是否为 Apple Silicon
if [[ "$(uname -m)" == "arm64" ]]; then
    echo "🍎 Apple Silicon 检测到，启用 MPS 加速"
    echo "   PYTORCH_ENABLE_MPS_FALLBACK=1"
else
    echo "🖥️ Intel Mac，使用 CPU 模式"
    export OMP_NUM_THREADS=$(sysctl -n hw.ncpu)
    echo "   OMP_NUM_THREADS=$OMP_NUM_THREADS"
fi

python api_server.py --host 0.0.0.0 --port 8000
EOF
    chmod +x "$INSTALL_DIR/start_tts_server.sh"
    echo "✅ 启动脚本已创建: $INSTALL_DIR/start_tts_server.sh"
}

# 验证 MPS 可用性
verify_mps() {
    if [[ "$USE_MPS" == true ]]; then
        echo ""
        echo "🔍 验证 MPS 加速是否可用..."
        local venv_python
        venv_python=$(get_venv_python)
        "$venv_python" -c "
import torch
if torch.backends.mps.is_available():
    print('✅ MPS 加速可用！PyTorch 版本:', torch.__version__)
    device = torch.device('mps')
    # 简单测试
    x = torch.randn(2, 3, device=device)
    print('   MPS 设备测试通过')
else:
    print('⚠️ MPS 不可用，将使用 CPU 模式')
    if not torch.backends.mps.is_built():
        print('   原因: PyTorch 未编译 MPS 支持')
" 2>/dev/null || echo "⚠️ MPS 验证跳过（可能需要先完成模型下载）"
    fi
}

# 主流程
main() {
    detect_mac
    check_mps
    install_system_deps
    setup_index_tts
    install_python_deps
    verify_mps
    download_models
    create_start_script

    echo ""
    echo "========================================"
    echo "  ✅ Index-TTS 安装完成！(macOS)"
    echo "========================================"
    echo ""
    if [[ "$USE_MPS" == true ]]; then
        echo "🍎 安装模式: MPS 加速 (Apple Silicon)"
        echo "   预期性能: 约为 NVIDIA RTX 3060 的 50-70%"
    else
        echo "🖥️ 安装模式: CPU (Intel Mac)"
        echo "   推理速度较慢，建议短文本使用"
    fi
    echo ""

    # 检查日语模型是否可用
    local ja_status="❌ 不可用"
    if [[ -f "$INSTALL_DIR/checkpoints/ja/bpe.model" && -f "$INSTALL_DIR/checkpoints/ja/gpt.pth" && -f "$INSTALL_DIR/checkpoints/ja/config.yaml" ]]; then
        ja_status="✅ 可用"
    fi

    echo "📌 模型状态:"
    echo "   中文模型: $INSTALL_DIR/checkpoints"
    echo "   日语模型: $INSTALL_DIR/checkpoints/ja ($ja_status)"
    echo ""
    echo "📌 后续步骤:"
    echo ""
    echo "  1️⃣  启动 TTS API 服务:"
    echo "     运行 ./run_index_tts.sh"
    echo ""
    echo "  2️⃣  服务默认运行在 http://127.0.0.1:8000"
    echo "     在 HX-SayBook 配置中心的 TTS 供应商中填入此地址即可"
    echo ""
    echo "💡 macOS 提示:"
    echo "   - 如遇到 MPS 兼容性问题，设置 PYTORCH_ENABLE_MPS_FALLBACK=1"
    echo "   - 首次推理可能较慢（MPS 编译缓存），后续会明显加速"
    echo "   - 建议关闭其他占用内存的应用以获得最佳性能"
    echo ""
}

main "$@"
