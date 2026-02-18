"""
LuxTTS (ZipVoice) API Server
为 HX-SayBook 提供 REST API 接口，桥接 ZipVoice 推理引擎。
接口与 Index-TTS API Server 完全兼容，可无缝切换。

接口列表:
  GET  /              - 服务信息（用于连接测试）
  GET  /v1/models     - 获取模型信息
  POST /v2/synthesize - 语音合成
  GET  /v1/check/audio - 检查参考音频是否存在
  POST /v1/upload_audio - 上传参考音频

启动方式:
  python api_server_lux.py --host 0.0.0.0 --port 8000
"""

import argparse
import hashlib
import os
import sys
import tempfile
import threading
import time
import warnings

warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", category=UserWarning)

# 确保能导入 zipvoice 模块
current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, current_dir)

import uvicorn
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
from typing import List, Optional


# ============================================================
# 命令行参数
# ============================================================
parser = argparse.ArgumentParser(description="LuxTTS (ZipVoice) API Server")
parser.add_argument("--host", type=str, default="0.0.0.0", help="监听地址")
parser.add_argument("--port", type=int, default=8000, help="监听端口")
parser.add_argument(
    "--model_name", type=str, default="zipvoice",
    help="模型名称: zipvoice / zipvoice_distill"
)
parser.add_argument("--fp16", action="store_true", default=False, help="使用 FP16 推理")
parser.add_argument("--device", type=str, default=None, help="推理设备 (cuda:0 / cpu)")
args = parser.parse_args()

# ============================================================
# 全局变量
# ============================================================
# 参考音频存储目录
PROMPTS_DIR = os.path.join(current_dir, "prompts")
os.makedirs(PROMPTS_DIR, exist_ok=True)

# 输出音频临时目录
OUTPUTS_DIR = os.path.join(current_dir, "outputs", "api")
os.makedirs(OUTPUTS_DIR, exist_ok=True)

# ============================================================
# 初始化 ZipVoice TTS 模型
# ============================================================
print("=" * 50)
print("  LuxTTS (ZipVoice) API Server 启动中...")
print(f"  模型: {args.model_name}")
print("=" * 50)

# 延迟导入，确保路径已设置
try:
    from zipvoice.zipvoice_infer import ZipVoiceTTS
except ImportError:
    print("⚠️ 无法导入 ZipVoiceTTS，尝试其他导入方式...")
    try:
        from zipvoice_infer import ZipVoiceTTS
    except ImportError:
        print("❌ 无法导入 ZipVoiceTTS 模块，请确认 ZipVoice 已正确安装")
        sys.exit(1)


class TTSModelManager:
    """ZipVoice TTS 模型管理器"""

    def __init__(self, model_name: str = "zipvoice", device: str = None):
        self._lock = threading.Lock()
        self._model_name = model_name
        self._device = device
        self._tts = None

    def _load(self):
        """加载 ZipVoice 模型"""
        print(f"📦 加载 ZipVoice 模型: {self._model_name}...")
        kwargs = {"model_name": self._model_name}
        if self._device:
            kwargs["device"] = self._device
        self._tts = ZipVoiceTTS(**kwargs)
        print(f"✅ ZipVoice 模型加载完成")

    def get_tts(self) -> ZipVoiceTTS:
        """获取 TTS 实例（线程安全）"""
        with self._lock:
            if self._tts is None:
                self._load()
            return self._tts

    @property
    def model_name(self):
        return self._model_name


# 初始化模型管理器
tts_manager = TTSModelManager(
    model_name=args.model_name,
    device=args.device,
)
print("\n📦 初始加载 ZipVoice 模型...")
tts_manager.get_tts()

# ============================================================
# FastAPI 应用
# ============================================================
app = FastAPI(title="LuxTTS (ZipVoice) API", version="1.0.0")


def _safe_filename(name: str) -> str:
    """将文件路径转为安全的文件名（用 hash 作为唯一标识）"""
    h = hashlib.md5(name.encode("utf-8")).hexdigest()[:16]
    ext = os.path.splitext(name)[1] or ".wav"
    return f"{h}{ext}"


# ============================================================
# GET / — 服务信息（连接测试）
# ============================================================
@app.get("/")
async def root():
    return {
        "name": "LuxTTS (ZipVoice) API Server",
        "version": "1.0.0",
        "engine": "ZipVoice",
        "endpoints": [
            "/v1/models",
            "/v2/synthesize",
            "/v1/check/audio",
            "/v1/upload_audio",
        ],
    }


# ============================================================
# GET /v1/models — 获取模型信息
# ============================================================
@app.get("/v1/models")
async def get_models():
    return {
        "models": [
            {
                "id": "lux-tts",
                "name": "LuxTTS (ZipVoice)",
                "description": "ZipVoice 轻量级零样本语音合成模型，显存占用约 1GB",
                "model_name": tts_manager.model_name,
            }
        ]
    }


# ============================================================
# POST /v2/synthesize — 语音合成（兼容 Index-TTS 接口）
# ============================================================
class SynthesizeRequest(BaseModel):
    text: str
    audio_path: str  # 参考音频文件名（上传时的原始路径或文件名）
    emo_text: Optional[str] = None  # LuxTTS 不支持，但保持兼容
    emo_vector: Optional[List[float]] = None  # LuxTTS 不支持，但保持兼容
    language: Optional[str] = None  # 语言: "zh"(中文) / "en"(英语)


@app.post("/v2/synthesize")
async def synthesize(req: SynthesizeRequest):
    # 查找参考音频
    safe_name = _safe_filename(req.audio_path)
    prompt_path = os.path.join(PROMPTS_DIR, safe_name)

    if not os.path.isfile(prompt_path):
        return JSONResponse(
            status_code=400,
            content={"error": f"参考音频不存在: {req.audio_path}，请先上传"},
        )

    # 生成输出文件路径
    output_name = f"tts_{int(time.time() * 1000)}.wav"
    output_path = os.path.join(OUTPUTS_DIR, output_name)

    try:
        active_tts = tts_manager.get_tts()

        # ZipVoice 推理
        # ZipVoice 需要参考音频的文字转录，这里留空让模型自动识别
        # 或者使用简单的占位文本
        active_tts.infer(
            spk_audio_prompt=prompt_path,
            text=req.text,
            output_path=output_path,
        )

        if not os.path.isfile(output_path):
            return JSONResponse(
                status_code=500, content={"error": "语音合成失败，未生成音频文件"}
            )

        with open(output_path, "rb") as f:
            audio_bytes = f.read()

        # 清理临时文件
        try:
            os.remove(output_path)
        except OSError:
            pass

        return Response(content=audio_bytes, media_type="audio/wav")

    except Exception as e:
        import traceback
        traceback.print_exc()
        return JSONResponse(
            status_code=500, content={"error": f"语音合成异常: {str(e)}"}
        )


# ============================================================
# GET /v1/check/audio — 检查参考音频是否存在
# ============================================================
@app.get("/v1/check/audio")
async def check_audio(file_name: str):
    safe_name = _safe_filename(file_name)
    exists = os.path.isfile(os.path.join(PROMPTS_DIR, safe_name))
    return {"exists": exists, "file_name": file_name}


# ============================================================
# POST /v1/upload_audio — 上传参考音频
# ============================================================
@app.post("/v1/upload_audio")
async def upload_audio(
    audio: UploadFile = File(...),
    full_path: Optional[str] = Form(None),
):
    try:
        # 用 full_path 作为唯一标识，如果没有则用上传的文件名
        identifier = full_path or audio.filename or "unknown.wav"
        safe_name = _safe_filename(identifier)
        save_path = os.path.join(PROMPTS_DIR, safe_name)

        content = await audio.read()
        with open(save_path, "wb") as f:
            f.write(content)

        return {
            "code": 200,
            "msg": "上传成功",
            "file_name": identifier,
            "saved_as": safe_name,
            "size": len(content),
        }
    except Exception as e:
        return JSONResponse(
            status_code=500, content={"code": 500, "msg": f"上传失败: {str(e)}"}
        )


# ============================================================
# GET /v1/all_urls — 获取所有 TTS 实例的 URL 列表（一键复制）
# 用途：用户在推理端启动多个实例后，通过此接口一次性获取所有 URL，
#       然后在 Web 端"一键导入 TTS 链接"中粘贴使用。
#
# 支持两种模式：
#   1. 环境变量 TTS_ALL_URLS（逗号分隔）手动指定所有兄弟实例地址
#   2. 环境变量 TTS_INSTANCE_COUNT + TTS_BASE_PORT 自动生成连续端口列表
#   3. 都不设置时，仅返回当前实例自身的地址
# ============================================================
@app.get("/v1/all_urls")
async def get_all_urls():
    urls: list[str] = []

    # 模式 1：环境变量直接指定所有 URL
    env_urls = os.environ.get("TTS_ALL_URLS", "").strip()
    if env_urls:
        urls = [u.strip() for u in env_urls.split(",") if u.strip()]
    else:
        # 模式 2：根据实例数量 + 基础端口自动生成
        instance_count = int(os.environ.get("TTS_INSTANCE_COUNT", "0"))
        base_port = int(os.environ.get("TTS_BASE_PORT", str(args.port)))
        if instance_count > 1:
            # 获取外部可访问的主机名
            host = os.environ.get("TTS_PUBLIC_HOST", "127.0.0.1")
            urls = [f"http://{host}:{base_port + i}" for i in range(instance_count)]
        else:
            # 模式 3：仅返回自身
            host = os.environ.get("TTS_PUBLIC_HOST", "127.0.0.1")
            urls = [f"http://{host}:{args.port}"]

    # 返回结果：urls 列表 + 预格式化的逗号分隔文本（方便一键复制）
    return {
        "urls": urls,
        "count": len(urls),
        "copy_text": ", ".join(urls),
        "engine": "LuxTTS (ZipVoice)",
    }


# ============================================================
# 启动服务
# ============================================================
if __name__ == "__main__":
    print(f"\n🚀 LuxTTS (ZipVoice) API Server 运行在 http://{args.host}:{args.port}")
    print(f"   模型: {tts_manager.model_name}")
    print(f"   参考音频目录: {PROMPTS_DIR}")
    print()
    uvicorn.run(app, host=args.host, port=args.port)
