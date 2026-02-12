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
check_gpu() {
    if command -v nvidia-smi &> /dev/null; then
        echo "✅ 检测到 NVIDIA GPU"
        nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null || true
        return 0
    else
        echo "⚠️ 未检测到 NVIDIA GPU，Index-TTS 需要 GPU 支持"
        echo "   如果你确定有 GPU，请先安装 NVIDIA 驱动和 CUDA"
        read -p "   是否继续安装？[y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
}

# 安装系统依赖
install_system_deps() {
    case $OS in
        arch)
            echo "📦 安装 Arch Linux 系统依赖..."
            sudo pacman -S --needed --noconfirm python python-pip git ffmpeg cuda cudnn
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
    if command -v uv &> /dev/null; then
        echo "   使用 uv 安装..."
        cd "$INSTALL_DIR"
        uv venv
        uv pip install -r requirements.txt
    else
        echo "   使用 pip 安装..."
        cd "$INSTALL_DIR"
        python3 -m venv venv
        source venv/bin/activate
        pip install -r requirements.txt
    fi
}

# 下载模型
download_models() {
    echo "📥 下载模型文件..."
    cd "$INSTALL_DIR"
    # 按照 Index-TTS 官方说明下载模型
    echo "   请按照 Index-TTS 官方文档手动下载模型文件"
    echo "   参考: https://github.com/index-tts/index-tts#模型下载"
}

# 创建启动脚本
create_start_script() {
    cat > "$INSTALL_DIR/start_tts_server.sh" << 'EOF'
#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
if [[ -d "venv" ]]; then
    source venv/bin/activate
fi
python api.py --host 0.0.0.0 --port 8000
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
    echo "启动 TTS 服务:"
    echo "  cd $INSTALL_DIR && ./start_tts_server.sh"
    echo ""
    echo "TTS 服务默认运行在 http://127.0.0.1:8000"
    echo ""
}

main "$@"
