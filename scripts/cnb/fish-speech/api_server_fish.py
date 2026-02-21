"""
Fish-Speech 1.5 API Server（极速模式）
为 HX-SayBook 提供 REST API 接口，桥接 Fish-Speech 1.5 推理引擎。
API 接口与 Index-TTS 完全兼容，可无缝切换。

设计目标: 单说话人 + 极速推理 + 简单部署
  - 不使用多情绪（Fish-Speech 自身可从文本推断情绪）
  - 单参考音频预加载，避免每次推理重新编码
  - RTF ~0.1，延迟 <150ms，显存 ≥4GB
  - 使用 Fish-Speech 自带 API server 作为后端

两种运行模式:
  1. 独立模式: 内置 Fish-Speech 推理（需安装 fish-speech 包）
  2. 代理模式: 转发请求到 Fish-Speech 自带 API server

接口列表（与 Index-TTS 完全兼容）:
  GET  /              - 服务信息（用于连接测试）
  GET  /v1/models     - 获取模型信息
  POST /v2/synthesize - 语音合成
  GET  /v1/check/audio - 检查参考音频是否存在
  POST /v1/upload_audio - 上传参考音频

启动方式:
  # 代理模式（推荐，先启动 Fish-Speech 自带 API server）:
  python api_server_fish.py --mode proxy --fish_api http://localhost:8080

  # 独立模式（需安装 fish-speech 包）:
  python api_server_fish.py --mode standalone
"""

import argparse
import base64
import hashlib
import io
import os
import sys
import time
import warnings

warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", category=UserWarning)

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
parser = argparse.ArgumentParser(description="Fish-Speech 1.5 API Server (极速模式)")
parser.add_argument("--host", type=str, default="0.0.0.0", help="监听地址")
parser.add_argument("--port", type=int, default=8000, help="监听端口")
parser.add_argument(
    "--mode", type=str, default="proxy", choices=["proxy", "standalone"],
    help="运行模式: proxy(代理转发) / standalone(独立推理)"
)
parser.add_argument(
    "--fish_api", type=str, default="http://localhost:8080",
    help="[代理模式] Fish-Speech API server 地址"
)
parser.add_argument(
    "--model_path", type=str, default="checkpoints/fish-speech-1.5",
    help="[独立模式] Fish-Speech 模型路径"
)
parser.add_argument(
    "--device", type=str, default=None, help="推理设备 (cuda / cpu)"
)
parser.add_argument(
    "--compile", action="store_true", default=False,
    help="[独立模式] 使用 torch.compile 加速推理"
)
args, _ = parser.parse_known_args()

# ============================================================
# 全局变量
# ============================================================
PROMPTS_DIR = os.path.join(current_dir, "prompts")
os.makedirs(PROMPTS_DIR, exist_ok=True)

OUTPUTS_DIR = os.path.join(current_dir, "outputs", "api")
os.makedirs(OUTPUTS_DIR, exist_ok=True)

# Fish-Speech 输出采样率
OUTPUT_SAMPLE_RATE = 44100


# ============================================================
# 代理模式：将请求转发到 Fish-Speech 自带 API server
# ============================================================
class FishSpeechProxyEngine:
    """代理模式引擎：转发请求到 Fish-Speech API server

    Fish-Speech 自带 API server 提供以下端点:
      POST /v1/tts        - msgpack 格式（高效）
      POST /audio/speech   - OpenAI 兼容格式（简单）

    本代理使用 /audio/speech 端点，因为它支持 form-data 上传参考音频。
    """

    def __init__(self, fish_api_url: str):
        self._base_url = fish_api_url.rstrip("/")
        # 缓存: reference_path -> reference_id
        self._ref_cache: dict[str, str] = {}

    def infer(
        self,
        prompt_wav: str,
        text: str,
        output_path: str,
        language: str = None,
    ) -> bool:
        """通过代理调用 Fish-Speech 进行语音合成"""
        import requests

        print(f"[代理] text={text[:50]}... prompt={os.path.basename(prompt_wav)}")
        start_time = time.time()

        try:
            # 读取参考音频
            with open(prompt_wav, "rb") as f:
                audio_data = f.read()

            # 使用 /audio/speech 端点（OpenAI 兼容格式）
            url = f"{self._base_url}/audio/speech"

            # form-data 方式发送
            files = {
                "reference_audio": (os.path.basename(prompt_wav), audio_data, "audio/wav"),
            }
            data = {
                "model": "fish-speech-1.5",
                "input": text,
                "response_format": "wav",
            }

            resp = requests.post(url, files=files, data=data, timeout=300)

            if resp.status_code != 200:
                # 回退: 尝试 /v1/tts 端点
                print(f"[代理] /audio/speech 返回 {resp.status_code}，尝试 /v1/tts...")
                return self._infer_via_v1_tts(audio_data, text, output_path)

            # 保存音频
            with open(output_path, "wb") as f:
                f.write(resp.content)

            elapsed = time.time() - start_time
            print(f"[代理] ✅ 成功 ({elapsed:.2f}s): {output_path}")
            return True

        except Exception as e:
            import traceback
            elapsed = time.time() - start_time
            print(f"[代理] ❌ 异常 ({elapsed:.2f}s): {e}")
            traceback.print_exc()
            return False

    def _infer_via_v1_tts(
        self,
        audio_data: bytes,
        text: str,
        output_path: str,
    ) -> bool:
        """回退：通过 /v1/tts 端点发送（msgpack 格式）"""
        try:
            import requests

            # 尝试使用 ormsgpack（Fish-Speech 推荐）
            try:
                import ormsgpack

                payload = {
                    "text": text,
                    "references": [
                        {
                            "audio": audio_data,
                            "text": "",  # Fish-Speech 会自动 ASR 识别
                        }
                    ],
                    "format": "wav",
                    "streaming": False,
                }

                url = f"{self._base_url}/v1/tts"
                resp = requests.post(
                    url,
                    data=ormsgpack.packb(payload),
                    headers={"Content-Type": "application/msgpack"},
                    timeout=300,
                )
            except ImportError:
                # 没有 ormsgpack，用 JSON + base64
                import json

                payload = {
                    "text": text,
                    "references": [
                        {
                            "audio": base64.b64encode(audio_data).decode(),
                            "text": "",
                        }
                    ],
                    "format": "wav",
                    "streaming": False,
                }

                url = f"{self._base_url}/v1/tts"
                resp = requests.post(
                    url,
                    json=payload,
                    timeout=300,
                )

            if resp.status_code == 200:
                with open(output_path, "wb") as f:
                    f.write(resp.content)
                return True
            else:
                print(f"[代理] /v1/tts 也失败: {resp.status_code} {resp.text[:200]}")
                return False

        except Exception as e:
            print(f"[代理] /v1/tts 异常: {e}")
            return False


# ============================================================
# 独立模式：直接调用 Fish-Speech 推理
# ============================================================
class FishSpeechStandaloneEngine:
    """独立模式引擎：直接加载 Fish-Speech 模型进行推理

    需要安装 fish-speech 包:
      pip install fish-speech
    或从源码安装:
      git clone https://github.com/fishaudio/fish-speech
      cd fish-speech && pip install -e .
    """

    def __init__(self, model_path: str, device: str = None, compile: bool = False):
        self._model_path = model_path
        self._device = device or "cuda"
        self._compile = compile
        self._model = None

    def load_model(self):
        """加载 Fish-Speech 模型"""
        print(f"📦 加载 Fish-Speech 模型: {self._model_path} ...")

        try:
            # Fish-Speech 的推理 API
            from fish_speech.inference import TTSInference

            self._model = TTSInference(
                model_path=self._model_path,
                device=self._device,
                compile=self._compile,
            )
            print(f"✅ Fish-Speech 模型加载完成 (device={self._device})")

        except ImportError:
            try:
                # 回退：尝试另一种导入方式
                from tools.llama.generate import load_model
                from tools.vqgan.inference import load_model as load_vqgan

                self._llama_model = load_model(
                    config_name="firefly_gan_vq",
                    checkpoint_path=os.path.join(self._model_path, "firefly-gan-vq-fsq-8x1024-21hz-generator.pth"),
                    device=self._device,
                )
                self._vqgan_model = load_vqgan(
                    config_name="firefly_gan_vq",
                    checkpoint_path=os.path.join(self._model_path, "firefly-gan-vq-fsq-8x1024-21hz-generator.pth"),
                    device=self._device,
                )
                print(f"✅ Fish-Speech 模型加载完成 (回退模式, device={self._device})")

            except Exception as e2:
                raise RuntimeError(
                    f"Fish-Speech 加载失败: {e2}\n"
                    f"请确保已安装 fish-speech: pip install fish-speech\n"
                    f"或使用代理模式: --mode proxy"
                )

    def infer(
        self,
        prompt_wav: str,
        text: str,
        output_path: str,
        language: str = None,
    ) -> bool:
        """直接调用 Fish-Speech 进行推理"""
        print(f"[推理] text={text[:50]}... prompt={os.path.basename(prompt_wav)}")
        start_time = time.time()

        try:
            import soundfile as sf

            if self._model is not None:
                # 使用 TTSInference API
                audio = self._model.synthesize(
                    text=text,
                    reference_audio=prompt_wav,
                    reference_text="",  # 自动 ASR
                )

                if hasattr(audio, 'numpy'):
                    audio = audio.numpy()
                if audio.ndim > 1:
                    audio = audio.squeeze()

                sf.write(output_path, audio, OUTPUT_SAMPLE_RATE)
            else:
                print("[推理] ❌ 模型未加载")
                return False

            elapsed = time.time() - start_time

            # 清理显存
            try:
                import torch
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except Exception:
                pass

            if os.path.isfile(output_path):
                file_size = os.path.getsize(output_path)
                print(f"[推理] ✅ 成功 ({elapsed:.2f}s, {file_size/1024:.1f}KB)")
                return True
            else:
                print(f"[推理] ❌ 文件未生成")
                return False

        except Exception as e:
            import traceback
            elapsed = time.time() - start_time
            print(f"[推理] ❌ 异常 ({elapsed:.2f}s): {e}")
            traceback.print_exc()
            return False


# ============================================================
# 根据模式选择引擎
# ============================================================
if args.mode == "proxy":
    tts_engine = FishSpeechProxyEngine(fish_api_url=args.fish_api)
    engine_desc = f"代理模式 → {args.fish_api}"
else:
    tts_engine = FishSpeechStandaloneEngine(
        model_path=args.model_path,
        device=args.device,
        compile=args.compile,
    )
    engine_desc = f"独立模式 ({args.model_path})"

# ============================================================
# FastAPI 应用
# ============================================================
app = FastAPI(title="Fish-Speech 1.5 API (极速模式)", version="1.0.0")


@app.on_event("startup")
async def startup_event():
    """启动时加载模型（独立模式）"""
    print("=" * 50)
    print("  Fish-Speech 1.5 API Server (极速模式)")
    print(f"  模式: {engine_desc}")
    print("  特点: 单说话人 / 极速推理 / 显存 ≥4GB")
    print("=" * 50)

    if args.mode == "standalone":
        tts_engine.load_model()

    print(f"\n🏁 Fish-Speech 极速模式就绪")


def _safe_filename(name: str) -> str:
    """将文件路径转为安全的文件名"""
    h = hashlib.md5(name.encode("utf-8")).hexdigest()[:16]
    ext = os.path.splitext(name)[1] or ".wav"
    return f"{h}{ext}"


# ============================================================
# GET / — 服务信息（连接测试）
# ============================================================
@app.get("/")
async def root():
    return {
        "name": "Fish-Speech 1.5 API Server (极速模式)",
        "version": "1.0.0",
        "engine": "Fish-Speech 1.5",
        "mode": args.mode,
        "sample_rate": OUTPUT_SAMPLE_RATE,
        "features": [
            "Single speaker (fast mode)",
            "RTF ~0.1",
            "Latency <150ms",
            "VRAM ≥4GB",
            "Auto emotion from text",
        ],
        "endpoints": [
            "/v1/models",
            "/v2/synthesize",
            "/v1/check/audio",
            "/v1/upload_audio",
        ],
    }


# ============================================================
# GET /v1/models
# ============================================================
@app.get("/v1/models")
async def get_models():
    return {
        "models": [
            {
                "id": "fish-speech-1.5",
                "name": "Fish-Speech 1.5",
                "description": "Fish-Speech 1.5 极速语音合成 (DualAR, RTF 0.1, 单说话人模式)",
                "mode": args.mode,
                "sample_rate": OUTPUT_SAMPLE_RATE,
            }
        ]
    }


# ============================================================
# POST /v2/synthesize — 语音合成（兼容 Index-TTS 接口）
# ============================================================
class SynthesizeRequest(BaseModel):
    text: str
    audio_path: str  # 参考音频文件名
    emo_text: Optional[str] = None  # Fish-Speech 自动从文本推断情绪，此参数忽略
    emo_vector: Optional[List[float]] = None  # 兼容保留，不使用
    language: Optional[str] = None  # 语言
    speed: Optional[float] = None  # 语速（Fish-Speech 通过 text 控制，此参数保留兼容）


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

    # 生成输出路径
    output_name = f"tts_{int(time.time() * 1000)}.wav"
    output_path = os.path.join(OUTPUTS_DIR, output_name)

    try:
        success = tts_engine.infer(
            prompt_wav=prompt_path,
            text=req.text,
            output_path=output_path,
            language=req.language,
        )

        if not success or not os.path.isfile(output_path):
            return JSONResponse(
                status_code=500,
                content={"error": "语音合成失败，请查看服务端日志"},
            )

        with open(output_path, "rb") as f:
            audio_bytes = f.read()

        try:
            os.remove(output_path)
        except OSError:
            pass

        return Response(content=audio_bytes, media_type="audio/wav")

    except Exception as e:
        import traceback
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={"error": f"语音合成异常: {str(e)}"},
        )


# ============================================================
# GET /v1/check/audio
# ============================================================
@app.get("/v1/check/audio")
async def check_audio(file_name: str):
    safe_name = _safe_filename(file_name)
    exists = os.path.isfile(os.path.join(PROMPTS_DIR, safe_name))
    return {"exists": exists, "file_name": file_name}


# ============================================================
# POST /v1/upload_audio
# ============================================================
@app.post("/v1/upload_audio")
async def upload_audio(
    audio: UploadFile = File(...),
    full_path: Optional[str] = Form(None),
):
    try:
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
            status_code=500,
            content={"code": 500, "msg": f"上传失败: {str(e)}"},
        )


# ============================================================
# GET /v1/all_urls
# ============================================================
@app.get("/v1/all_urls")
async def get_all_urls():
    urls: list[str] = []

    env_urls = os.environ.get("TTS_ALL_URLS", "").strip()
    if env_urls:
        urls = [u.strip() for u in env_urls.split(",") if u.strip()]
    else:
        instance_count = int(os.environ.get("TTS_INSTANCE_COUNT", "0"))
        base_port = int(os.environ.get("TTS_BASE_PORT", str(args.port)))
        if instance_count > 1:
            host = os.environ.get("TTS_PUBLIC_HOST", "127.0.0.1")
            urls = [f"http://{host}:{base_port + i}" for i in range(instance_count)]
        else:
            host = os.environ.get("TTS_PUBLIC_HOST", "127.0.0.1")
            urls = [f"http://{host}:{args.port}"]

    return {
        "urls": urls,
        "count": len(urls),
        "copy_text": ", ".join(urls),
        "engine": "Fish-Speech 1.5 (极速模式)",
    }


# ============================================================
# 启动服务
# ============================================================
if __name__ == "__main__":
    print(f"\n🚀 Fish-Speech 1.5 API Server (极速模式) 运行在 http://{args.host}:{args.port}")
    print(f"   模式: {engine_desc}")
    print(f"   参考音频目录: {PROMPTS_DIR}")
    print()
    uvicorn.run(app, host=args.host, port=args.port)
