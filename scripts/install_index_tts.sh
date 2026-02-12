#!/usr/bin/env bash
# ============================================================
# Index-TTS 一键安装脚本
# 支持 Windows (Git Bash/WSL) 和 Arch Linux
# ============================================================
set -e

echo "========================================"
echo "  Index-TTS 安装向导"
echo "========================================"

INSTALL_DIR="$(cd "$(dirname "$0")" && pwd)/index-tts"

# 检测系统
detect_os() {
    if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "mingw"* || "$OSTYPE" == "cygwin" ]]; then
        echo "windows"
    elif [[ -f /etc/arch-release ]]; then
        echo "arch"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        echo "linux"
    else
        echo "unknown"
    fi
}

OS=$(detect_os)
echo "📋 检测到操作系统: $OS"

# 检查 GPU
USE_GPU=false
check_gpu() {
    if command -v nvidia-smi &> /dev/null; then
        echo "✅ 检测到 NVIDIA GPU"
        nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null || true
        USE_GPU=true
    else
        echo "⚠️ 未检测到 NVIDIA GPU，将使用 CPU 模式安装"
        echo "   CPU 模式下推理速度较慢，但功能完整"
        USE_GPU=false
    fi
}

# 安装系统依赖
install_system_deps() {
    case $OS in
        arch)
            echo "📦 安装 Arch Linux 系统依赖..."
            if [[ "$USE_GPU" == true ]]; then
                sudo pacman -S --needed --noconfirm python python-pip git ffmpeg cuda cudnn
            else
                sudo pacman -S --needed --noconfirm python python-pip git ffmpeg
            fi
            ;;
        linux)
            echo "📦 安装 Linux 系统依赖..."
            if command -v apt &> /dev/null; then
                sudo apt update
                sudo apt install -y python3 python3-pip git ffmpeg
            elif command -v dnf &> /dev/null; then
                sudo dnf install -y python3 python3-pip git ffmpeg
            fi
            ;;
        windows)
            echo "📦 Windows: 请确保已安装 Python 3.10+, Git, ffmpeg, CUDA"
            ;;
    esac
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

        # --index-strategy unsafe-best-match: 解决 PyTorch 索引中 packaging 版本过旧
        # 导致 hatchling 构建失败的问题（PyTorch 索引只有 packaging<=24.1，
        # 而 hatchling>=1.27.0 需要 packaging>=24.2）
        if [[ "$USE_GPU" == true ]]; then
            echo "🚀 安装 GPU 版依赖 (CUDA)..."
            uv sync --index-strategy unsafe-best-match
        else
            echo "🖥️ 安装 CPU 版依赖..."
            # CPU 模式：覆盖 PyTorch 源为 CPU 版本
            UV_EXTRA_INDEX_URL="https://download.pytorch.org/whl/cpu" uv sync --no-cache --index-strategy unsafe-best-match
        fi

        # 安装 API Server 额外依赖 (fastapi, uvicorn)
        uv pip install fastapi uvicorn[standard]
    else
        echo "   使用 pip 管理环境..."
        python3 -m venv venv
        source venv/bin/activate

        if [[ "$USE_GPU" == true ]]; then
            echo "🚀 安装 GPU 版 PyTorch..."
            pip install torch torchvision torchaudio
        else
            echo "🖥️ 安装 CPU 版 PyTorch..."
            pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu
        fi

        pip install -r requirements.txt 2>/dev/null || pip install .
        pip install fastapi uvicorn[standard]
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
        echo "python"
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
        # modelscope 已在 pyproject.toml 中作为依赖安装
        if ! "$venv_python" -c "import modelscope" &>/dev/null 2>&1; then
            echo "   📦 安装 modelscope..."
            venv_pip_install modelscope
        fi
    elif [[ "$tool" == "huggingface" ]]; then
        # 检查 hf CLI（新版用 hf 命令）
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

    # 优先尝试 modelscope CLI 命令
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
        # 回退到 Python API
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

    # 如果设置了镜像站，使用镜像站
    if [[ -n "$HF_ENDPOINT" ]]; then
        echo "   🔗 使用 HuggingFace 镜像: $HF_ENDPOINT"
    fi

    # 查找 venv 内的 hf 或 huggingface-cli
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
        echo "   🎉 所有模型文件下载完成！"
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

# 创建启动脚本
create_start_script() {
    cat > "$INSTALL_DIR/start_tts_server.sh" << EOF
#!/usr/bin/env bash
set -e
cd "\$(dirname "\$0")"
if [[ -d ".venv" ]]; then
    source .venv/bin/activate
elif [[ -d "venv" ]]; then
    source venv/bin/activate
fi

# CPU 模式优化：设置线程数为 CPU 核心数
if ! command -v nvidia-smi &> /dev/null; then
    export OMP_NUM_THREADS=\$(nproc)
    echo "🖥️ CPU 模式，OMP_NUM_THREADS=\$OMP_NUM_THREADS"
fi

python api_server.py --host 0.0.0.0 --port 8000
EOF
    chmod +x "$INSTALL_DIR/start_tts_server.sh"
    echo "✅ 启动脚本已创建: $INSTALL_DIR/start_tts_server.sh"
}

# 主流程
main() {
    check_gpu
    install_system_deps
    setup_index_tts
    install_python_deps
    download_models
    create_start_script

    echo ""
    echo "========================================"
    echo "  ✅ Index-TTS 安装完成！"
    echo "========================================"
    echo ""
    if [[ "$USE_GPU" == true ]]; then
        echo "🚀 安装模式: GPU"
    else
        echo "🖥️ 安装模式: CPU（推理速度较慢，建议短文本使用）"
    fi
    echo ""
    echo "📌 后续步骤:"
    echo ""
    echo "  1️⃣  启动 TTS API 服务:"
    echo "     cd $INSTALL_DIR && ./start_tts_server.sh"
    echo ""
    echo "  2️⃣  服务默认运行在 http://127.0.0.1:8000"
    echo "     在 HX-SayBook 配置中心的 TTS 供应商中填入此地址即可"
    echo ""
}

main "$@"
