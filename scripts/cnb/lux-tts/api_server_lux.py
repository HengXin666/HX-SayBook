"""
LuxTTS API Server
为 HX-SayBook 提供 REST API 接口，桥接 LuxTTS (ZipVoice) 推理引擎。
接口与 Index-TTS API Server 完全兼容，可无缝切换。

使用 LuxTTS 官方 API：
  from zipvoice.luxvoice import LuxTTS
  lux_tts = LuxTTS('YatharthS/LuxTTS', device='cuda')
  encoded = lux_tts.encode_prompt(audio_path, rms=0.01)
  wav = lux_tts.generate_speech(text, encoded, num_steps=4)

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
parser = argparse.ArgumentParser(description="LuxTTS API Server")
parser.add_argument("--host", type=str, default="0.0.0.0", help="监听地址")
parser.add_argument("--port", type=int, default=8000, help="监听端口")
parser.add_argument(
    "--device", type=str, default=None, help="推理设备 (cuda / cpu / mps)"
)
# 使用 parse_known_args 忽略 uvicorn 传入的额外参数
args, _ = parser.parse_known_args()

# ============================================================
# 全局变量
# ============================================================
# 参考音频存储目录
PROMPTS_DIR = os.path.join(current_dir, "prompts")
os.makedirs(PROMPTS_DIR, exist_ok=True)

# 输出音频临时目录
OUTPUTS_DIR = os.path.join(current_dir, "outputs", "api")
os.makedirs(OUTPUTS_DIR, exist_ok=True)

# LuxTTS 输出采样率
OUTPUT_SAMPLE_RATE = 48000


# ============================================================
# LuxTTS 推理管理器
# 使用 LuxTTS 官方简洁 API，无需手动管理模型组件
# ============================================================


class TTSModelManager:
    """LuxTTS 推理管理器"""

    def __init__(self, device: str = None):
        self._device = device or "cuda"
        self._lux_tts = None  # LuxTTS 实例
        self._infer_lock = threading.Lock()  # GPU 推理锁

    def load_model(self):
        """
        启动时加载 LuxTTS 模型。
        使用 LuxTTS 官方 API，一行代码完成模型加载：
          lux_tts = LuxTTS('YatharthS/LuxTTS', device='cuda')
        """
        print("📦 加载 LuxTTS 模型...")

        try:
            from zipvoice.luxvoice import LuxTTS

            self._lux_tts = LuxTTS("YatharthS/LuxTTS", device=self._device)

            print(f"✅ LuxTTS 模型已加载 (device={self._device})")
            print("   后续推理将直接使用内存中的模型，无需冷启动 🚀")

        except Exception as e:
            import traceback

            print(f"❌ LuxTTS 模型加载失败: {e}")
            traceback.print_exc()
            raise RuntimeError(f"LuxTTS 模型加载失败: {e}")

    def infer(
        self,
        prompt_wav: str,
        text: str,
        output_path: str,
        prompt_text: str = None,
        language: str = None,
    ) -> bool:
        """调用 LuxTTS 进行语音合成

        Args:
            prompt_wav: 参考音频路径
            text: 要合成的文本
            output_path: 输出音频路径
            prompt_text: 参考音频的文字转录（LuxTTS 内置 whisper 自动识别，此参数忽略）
            language: Whisper 识别语言，如 'zh'、'en'、'ja' 等，None 为自动检测

        Returns:
            True if success, False otherwise
        """
        print(f"[推理] text={text[:50]}... prompt={os.path.basename(prompt_wav)}")
        start_time = time.time()

        try:
            with self._infer_lock:
                import soundfile as sf

                # 1. 编码参考音频
                #    duration: 参考音频使用的最大秒数，设大可减少 artifacts（电音）
                #    rms: 音量归一化参数，0.01 为推荐值
                #    language: 指定 Whisper 识别语言，避免中文被误识别为日语
                encoded_prompt = self._lux_tts.encode_prompt(
                    prompt_wav, duration=10, rms=0.01, language=language
                )

                # 2. 生成语音
                #    num_steps=4: 蒸馏模型推荐 3-4 步
                #    t_shift=0.9: 采样温度，越高音质越好（但可能有发音错误），0.9 为官方推荐
                #    return_smooth=True: 平滑处理，消除金属电音
                final_wav = self._lux_tts.generate_speech(
                    text,
                    encoded_prompt,
                    num_steps=4,
                    guidance_scale=3.0,
                    t_shift=0.9,
                    speed=1.0,
                    return_smooth=True,
                )

                # 3. 保存为 WAV 文件（48kHz）
                wav_numpy = final_wav.numpy().squeeze()
                sf.write(output_path, wav_numpy, OUTPUT_SAMPLE_RATE)

            elapsed = time.time() - start_time

            # 推理完成后释放中间计算显存
            try:
                import torch

                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except Exception:
                pass

            if os.path.isfile(output_path):
                print(f"[推理] ✅ 成功 ({elapsed:.2f}s): {output_path}")
                return True
            else:
                print(f"[推理] ❌ 文件未生成: {output_path}")
                return False

        except Exception as e:
            import traceback

            elapsed = time.time() - start_time
            print(f"[推理] ❌ 异常 ({elapsed:.2f}s): {e}")
            traceback.print_exc()

            # OOM 等异常后清理显存
            try:
                import torch

                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except Exception:
                pass

            return False

    @property
    def model_name(self):
        return "LuxTTS"

    @property
    def mode(self):
        return "内存常驻"


# 创建模型管理器
tts_manager = TTSModelManager(device=args.device)

# ============================================================
# FastAPI 应用
# ============================================================
app = FastAPI(title="LuxTTS API", version="2.0.0")


@app.on_event("startup")
async def startup_event():
    """Worker 进程启动时加载 LuxTTS 模型"""
    print("=" * 50)
    print("  LuxTTS API Server 启动中...")
    print("=" * 50)
    tts_manager.load_model()
    print(f"\n🏁 推理模式: {tts_manager.mode}")


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
        "name": "LuxTTS API Server",
        "version": "2.0.0",
        "engine": "LuxTTS (ZipVoiceDistill)",
        "sample_rate": OUTPUT_SAMPLE_RATE,
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
                "name": "LuxTTS",
                "description": "LuxTTS 轻量级零样本语音合成模型，显存占用约 1GB，采样率 48kHz",
                "model_name": tts_manager.model_name,
                "sample_rate": OUTPUT_SAMPLE_RATE,
            }
        ]
    }


# ============================================================
# POST /v2/synthesize — 语音合成（兼容 Index-TTS 接口）
# ============================================================
class SynthesizeRequest(BaseModel):
    text: str
    audio_path: str  # 参考音频文件名（上传时的原始路径或文件名）
    prompt_text: Optional[str] = None  # LuxTTS 内置 whisper 自动识别，此参数忽略
    emo_text: Optional[str] = None  # LuxTTS 不支持，但保持兼容
    emo_vector: Optional[List[float]] = None  # LuxTTS 不支持，但保持兼容
    language: Optional[str] = None  # 语言


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
        # 语言映射：将常见语言名称映射为 Whisper 的语言代码
        lang_map = {
            "zh": "zh",
            "chinese": "zh",
            "中文": "zh",
            "en": "en",
            "english": "en",
            "英文": "en",
            "ja": "ja",
            "japanese": "ja",
            "日文": "ja",
            "ko": "ko",
            "korean": "ko",
            "韩文": "ko",
        }
        whisper_lang = None
        if req.language:
            whisper_lang = lang_map.get(
                req.language.lower().strip(), req.language.lower().strip()
            )

        success = tts_manager.infer(
            prompt_wav=prompt_path,
            text=req.text,
            output_path=output_path,
            prompt_text=req.prompt_text,
            language=whisper_lang,
        )

        if not success or not os.path.isfile(output_path):
            return JSONResponse(
                status_code=500, content={"error": "语音合成失败，请查看服务端日志"}
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
        "engine": "LuxTTS",
    }


# ============================================================
# 启动服务
# ============================================================
if __name__ == "__main__":
    print(f"\n🚀 LuxTTS API Server 运行在 http://{args.host}:{args.port}")
    print(f"   参考音频目录: {PROMPTS_DIR}")
    print()
    uvicorn.run(app, host=args.host, port=args.port)
