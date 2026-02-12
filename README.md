# 📚 HX-SayBook

> AI 多角色多情绪小说配音平台(基于 [SonicVale / 音谷](https://github.com/xcLee001/SonicVale) 二次开发)

将小说文本通过 LLM 自动拆分为带角色、情绪的台词, 然后通过 TTS(如 Index-TTS)合成多角色配音音频。

## ✨ 新增功能(相比原项目)

- 🎯 **批量LLM解析** — 支持选择章节范围, 批量队列转化, 全程显示日志和进度
- 🎙️ **批量TTS配音** — 按章节一键配音, WebSocket 实时推送进度
- 🎚️ **语音速度调节** — 全局/单条台词速度调节, 0.5x ~ 2.0x
- 🔧 **独立语音调试页面** — 脱离业务流程, 快速测试音色/情绪/速度组合
- 📊 **实时进度和日志** — 所有 LLM/TTS 操作都显示详细日志, 不再只是"加载中"
- 🌐 **Web 前端** — 从 Electron+Vue 重构为 React+TypeScript Web 端
- 📦 **uv 包管理** — 使用 uv 替代 pip, 更快的依赖安装
- 🖥️ **跨平台** — 支持 Windows 和 Arch Linux
- 🔌 **Index-TTS 一键安装** — 提供安装脚本

## 🏗️ 技术栈

| 模块 | 技术 |
|------|------|
| 后端 | Python 3.10+ / FastAPI / SQLAlchemy / WebSocket |
| 前端 | React 19 / TypeScript / Vite / Ant Design / Zustand |
| TTS | Index-TTS (可选) / 自定义 TTS API |
| LLM | OpenAI 兼容 API |
| 包管理 | uv (Python) / npm (前端) |

## 📁 项目结构

```
HX-SayBook/
├── py/                     # 后端 (FastAPI)
│   ├── core/               # 核心引擎 (LLM, TTS, 音频处理)
│   ├── routers/            # API 路由
│   │   ├── batch_router.py # 新增: 批量处理路由
│   │   ├── chapter_router.py
│   │   └── ...
│   ├── services/           # 业务逻辑
│   ├── models/             # 数据模型
│   ├── db/                 # 数据库
│   └── main.py             # 入口
├── web/                    # 前端 (React + TS)
│   ├── src/
│   │   ├── api/            # API 客户端
│   │   ├── hooks/          # 自定义 Hook (WebSocket)
│   │   ├── pages/          # 页面组件
│   │   ├── store/          # Zustand 状态管理
│   │   └── types/          # TypeScript 类型
│   └── package.json
├── scripts/                # 工具脚本
│   └── install_index_tts.sh
├── pyproject.toml          # Python 项目配置 (uv)
├── start.sh                # Linux 启动脚本
└── start.bat               # Windows 启动脚本
```

## 🚀 快速开始

### 1. 启动后端

```bash
# 方式一: 使用启动脚本(推荐)
chmod +x start.sh
./start.sh

# 方式二: 手动启动
uv sync
uv run uvicorn py.main:app --host 0.0.0.0 --port 8200 --reload
```

### 2. 启动前端

```bash
cd web
npm install
npm run dev
# 访问 http://localhost:3000
```

### 3. (可选) 安装 Index-TTS

Index-TTS 是一个高质量零样本语音克隆模型，支持多情绪合成。安装后可作为 TTS 服务供 HX-SayBook 调用。

#### 3.1 一键安装

```bash
chmod +x scripts/install_index_tts.sh
./scripts/install_index_tts.sh
```

脚本会自动完成：克隆仓库 → 检测 GPU/CPU → 安装依赖 → 下载模型 → 创建启动脚本

> ⚠️ **无 NVIDIA GPU** 时会自动安装 CPU 版 PyTorch，功能完整但推理较慢

#### 3.2 下载模型（如脚本未自动完成）

模型文件需放在 `scripts/index-tts/checkpoints/` 目录下：

| 文件 | 说明 |
|------|------|
| `bpe.model` | BPE 分词模型 |
| `gpt.pth` | GPT 语言模型 |
| `config.yaml` | 模型配置（已自带） |
| `s2mel.pth` | 声学模型 |
| `wav2vec2bert_stats.pt` | 特征提取统计 |
| `feat1.pt` | 说话人特征矩阵 |
| `feat2.pt` | 情感特征矩阵 |
| `qwen0.6bemo4-merge/` | Qwen 情感编码模型 |

下载方式（三选一）：

```bash
# 方式1: ModelScope（国内推荐）
pip install modelscope
modelscope download --model IndexTeam/IndexTTS-2 --local_dir scripts/index-tts/checkpoints

# 方式2: HuggingFace 镜像站
pip install huggingface_hub[cli]
HF_ENDPOINT=https://hf-mirror.com hf download IndexTeam/IndexTTS-2 --local-dir scripts/index-tts/checkpoints

# 方式3: HuggingFace 官方
pip install huggingface_hub[cli]
hf download IndexTeam/IndexTTS-2 --local-dir scripts/index-tts/checkpoints
```

#### 3.3 启动 TTS API 服务

```bash
cd scripts/index-tts
./start_tts_server.sh

# 或手动启动
source .venv/bin/activate  # 或 source venv/bin/activate
python api_server.py --host 0.0.0.0 --port 8000
```

启动成功后，API 服务运行在 `http://127.0.0.1:8000`

#### 3.4 对接 HX-SayBook

1. 启动 HX-SayBook 后端（`./start.sh`）
2. 打开前端，进入 **配置中心**
3. 找到 TTS 供应商 `index_tts`（系统自动创建）
4. 填入 API 地址：`http://127.0.0.1:8000`
5. 点击 **测试连接**，显示成功即可

## 📖 使用流程

1. **配置中心** — 添加 LLM 和 TTS 服务提供商
2. **创建项目** — 新建项目并关联 LLM/TTS/提示词
3. **导入章节** — 粘贴小说文本
4. **LLM 解析** — 单章或批量解析, 自动拆分台词并识别角色/情绪
5. **角色绑定** — 为角色分配音色
6. **TTS 配音** — 单章或批量配音, 实时查看进度
7. **语音调试** — 在独立页面微调音色/情绪/速度
8. **导出音频** — 导出最终配音文件

## 🔧 环境要求

- Python 3.10+
- Node.js 18+
- ffmpeg(系统 PATH 中或放到 `py/core/ffmpeg/` 下)
- (可选) NVIDIA GPU + CUDA（Index-TTS GPU 加速需要，CPU 模式也可用）

## 📝 License

AGPL-3.0
