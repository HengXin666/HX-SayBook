#!/bin/bash
# ============================================================
# 构建并推送 Index-TTS 日语增强镜像到 Docker Hub
#
# 用法:
#   bash build_and_push.sh <docker-hub-username>
#
# 示例:
#   bash build_and_push.sh myusername
#   → 构建并推送 myusername/index-tts-2-ja:latest
# ============================================================

set -e

# Docker Hub 用户名
DOCKER_USER="${1:?用法: bash build_and_push.sh <docker-hub-username>}"
IMAGE_NAME="$DOCKER_USER/index-tts-2-ja"
TAG="latest"

echo "========================================"
echo "  构建 Index-TTS 日语增强镜像"
echo "  镜像: $IMAGE_NAME:$TAG"
echo "========================================"

# 检查 Docker 是否可用
if ! command -v docker &> /dev/null; then
    echo "❌ 未找到 docker 命令，请先安装 Docker"
    exit 1
fi

# 检查 Docker daemon 是否运行
echo ""
echo "[0/3] 检查 Docker daemon 状态..."
if ! docker info &> /dev/null; then
    echo "❌ Docker daemon 未运行！"
    echo ""
    echo "  请先启动 Docker 服务："
    echo "    sudo systemctl start docker"
    echo ""
    echo "  或手动启动："
    echo "    sudo dockerd &"
    echo ""
    echo "  启动后重新运行本脚本。"
    exit 1
fi
echo "  ✅ Docker daemon 运行中"

# 检查是否已登录 Docker Hub
echo ""
echo "[1/3] 检查 Docker Hub 登录状态..."
if ! docker info 2>/dev/null | grep -q "Username"; then
    echo "  请先登录 Docker Hub:"
    docker login
fi

# 构建镜像
echo ""
echo "[2/3] 构建镜像..."
echo "  ⚠️  注意：构建过程需要下载日语模型（约 2-4 GB），可能需要较长时间"
echo ""

docker build \
    -t "$IMAGE_NAME:$TAG" \
    -f Dockerfile \
    .

echo ""
echo "  ✅ 镜像构建完成: $IMAGE_NAME:$TAG"

# 推送镜像
echo ""
echo "[3/3] 推送镜像到 Docker Hub..."
docker push "$IMAGE_NAME:$TAG"

echo ""
echo "========================================"
echo "  ✅ 全部完成!"
echo "  镜像: $IMAGE_NAME:$TAG"
echo ""
echo "  在 .cnb.yml 中使用:"
echo "    image: $IMAGE_NAME:$TAG"
echo "========================================"
