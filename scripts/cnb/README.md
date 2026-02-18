# CNB 平台 TTS 推理部署

本目录包含在 [CNB（Cloud Native Build）](https://cnb.cool) 平台上部署 HX-SayBook TTS 推理服务所需的全部配置文件。

## 📁 目录结构

```
scripts/cnb/
├── .cnb.yml                 # CNB 平台入口配置（支持选择容器）
├── README.md                # 本文件
├── index-tts/               # Index-TTS 引擎相关文件
│   ├── Dockerfile           # 构建日语增强镜像（基于 index-tts-2）
│   ├── build_and_push.sh    # 构建 & 推送镜像到 Docker Hub
│   └── start.sh             # 容器启动脚本
└── lux-tts/                 # LuxTTS (ZipVoice) 引擎相关文件
    ├── Dockerfile           # 构建轻量级 TTS 镜像
    ├── build_and_push.sh    # 构建 & 推送镜像到 Docker Hub
    ├── start_lux.sh         # 容器启动脚本
    └── api_server_lux.py    # LuxTTS API 服务器（兼容 Index-TTS 接口）
```

## 🚀 两种 TTS 引擎可选

在 CNB 平台打开云开发环境时，会弹出选择界面，可自由选择启动哪个容器：

| 选项 | 引擎 | 镜像 | 显存占用 | 特点 |
|:----:|------|------|:--------:|------|
| 1 | **Index-TTS** (中文+日语) | `hengxin666/index-tts-2-ja:latest` | ~4 GB | 高质量中日双语，情绪控制 |
| 2 | **LuxTTS** 轻量版 | `hengxin666/lux-tts:latest` | ~1 GB | 极低显存，8 并发处理 |

## ⚙️ 使用方式

### 方式一：CNB 平台直接使用

1. 将 `.cnb.yml` 复制到仓库**根目录**
2. 在 CNB 平台打开仓库 → 点击「打开云开发环境」
3. 选择要启动的容器（Index-TTS 或 LuxTTS）
4. 服务自动启动，监听 `0.0.0.0:8000`

> **注意**：`.cnb.yml` 需要放在仓库根目录才能被 CNB 平台识别。本目录下的 `.cnb.yml` 是配置源文件，使用时请复制到根目录。

### 方式二：手动构建 Docker 镜像

```bash
# 构建 Index-TTS 镜像
cd scripts/cnb/index-tts
bash build_and_push.sh <你的DockerHub用户名>

# 构建 LuxTTS 镜像
cd scripts/cnb/lux-tts
bash build_and_push.sh <你的DockerHub用户名>
```

## 📡 API 接口

两种引擎提供**完全兼容**的 REST API 接口，可无缝切换：

| 接口 | 方法 | 说明 |
|------|:----:|------|
| `/` | GET | 服务信息（连接测试） |
| `/v1/models` | GET | 获取模型信息 |
| `/v2/synthesize` | POST | 语音合成 |
| `/v1/check/audio` | GET | 检查参考音频是否存在 |
| `/v1/upload_audio` | POST | 上传参考音频 |
| `/v1/all_urls` | GET | 获取所有实例 URL（一键复制） |

### 语音合成示例

```bash
curl -X POST http://localhost:8000/v2/synthesize \
  -H "Content-Type: application/json" \
  -d '{
    "text": "你好，这是一段测试语音。",
    "audio_path": "ref_audio.wav",
    "language": "zh"
  }' \
  --output output.wav
```

## 🔧 环境变量

### LuxTTS 专用

| 变量 | 默认值 | 说明 |
|------|:------:|------|
| `LUX_TTS_WORKERS` | `8` | 并发 worker 数量 |
| `LUX_TTS_HOST` | `0.0.0.0` | 监听地址 |
| `LUX_TTS_PORT` | `8000` | 监听端口 |
| `LUX_TTS_MODEL` | `zipvoice` | 模型名称 |

### 通用（一键复制 URL 功能）

| 变量 | 说明 |
|------|------|
| `TTS_ALL_URLS` | 手动指定所有实例 URL（逗号分隔） |
| `TTS_INSTANCE_COUNT` | 实例数量（自动生成连续端口） |
| `TTS_BASE_PORT` | 基础端口号 |
| `TTS_PUBLIC_HOST` | 外部可访问的主机名 |
