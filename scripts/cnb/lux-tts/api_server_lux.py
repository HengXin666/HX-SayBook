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

# 强制 torchaudio 使用 soundfile 后端，避免 torchcodec 因缺少 FFmpeg 共享库而报错
# 新版 torchaudio (>=2.6) 默认使用 torchcodec，但 torchcodec 依赖系统 FFmpeg
try:
    import torchaudio

    # 优先尝试 soundfile 后端（纯 Python，不依赖 FFmpeg）
    try:
        torchaudio.set_audio_backend("soundfile")
        print("✅ torchaudio 后端已设置为 soundfile")
    except RuntimeError:
        # 某些版本的 torchaudio 不支持 set_audio_backend
        # 尝试通过环境变量禁用 torchcodec
        os.environ.setdefault("TORCHAUDIO_USE_BACKEND_DISPATCHER", "1")
        print("⚠️ torchaudio.set_audio_backend 不可用，将依赖默认后端")
except ImportError:
    pass

# 确保能导入 zipvoice 模块
current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, current_dir)

import subprocess
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
    "--model_name",
    type=str,
    default="zipvoice",
    help="模型名称: zipvoice / zipvoice_distill",
)
parser.add_argument("--fp16", action="store_true", default=False, help="使用 FP16 推理")
parser.add_argument("--device", type=str, default=None, help="推理设备 (cuda:0 / cpu)")
# 使用 parse_known_args 忽略 uvicorn 传入的额外参数（如 --workers, --timeout-keep-alive）
# 避免被 uvicorn 多 worker import 时 argparse 报 unrecognized arguments 错误
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

# ============================================================
# ZipVoice TTS 推理管理器
# 优先使用常驻内存模式（直接导入 zipvoice 模块，模型常驻 GPU 内存）
# 回退模式：通过 subprocess 调用 CLI（每次冷启动，较慢）
# ============================================================


class TTSModelManager:
    """ZipVoice TTS 推理管理器（优先常驻内存，回退 subprocess）"""

    def __init__(self, model_name: str = "zipvoice", device: str = None):
        self._model_name = model_name
        self._device = device
        self._model = None  # 常驻内存的 ZipVoice 模型
        self._vocoder = None  # 声码器 (Vocos)
        self._tokenizer = None  # 分词器 (EmiliaTokenizer)
        self._feature_extractor = None  # 特征提取器 (VocosFbank)
        self._torch_device = None  # torch.device 对象
        self._use_memory_mode = False  # 是否成功启用常驻内存模式
        self._infer_lock = threading.Lock()  # 推理锁（GPU 推理通常不支持并发）

    def load_model(self):
        """
        启动时加载 ZipVoice 模型到内存。
        流程：get_parser() → 解析参数 → 构建模型/vocoder/tokenizer → 加载权重
        如果失败则回退到 subprocess 模式。
        """
        print("📦 尝试加载 ZipVoice 模型到内存（常驻进程模式）...")

        try:
            import torch
            from zipvoice.bin.infer_zipvoice import (
                get_parser,
                get_vocoder,
                load_checkpoint,
                EmiliaTokenizer,
                VocosFbank,
                ZipVoice,
                ZipVoiceDistill,
            )

            # 1. 通过 get_parser() 获取参数解析器，然后用默认值 + 覆盖参数解析
            parser = get_parser()
            # 构造最小必需参数列表（模拟 CLI 调用）
            cli_args = ["--model-name", self._model_name]
            params = parser.parse_args(cli_args)

            # 2. 设置设备
            if self._device:
                device = torch.device(self._device)
            else:
                device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
            self._torch_device = device

            # 3. 加载声码器
            print("   📦 加载声码器 (Vocos)...")
            vocos_path = getattr(params, "vocos_local_path", None) or getattr(
                params, "vocoder_path", None
            )
            self._vocoder = get_vocoder(vocos_path)
            self._vocoder = self._vocoder.to(device).eval()
            print(f"   ✅ 声码器已加载到 {device}")

            # 4. 加载分词器
            print("   📦 加载分词器 (EmiliaTokenizer)...")
            token_file = getattr(params, "token_file", None) or getattr(
                params, "tokens", None
            )
            self._tokenizer = EmiliaTokenizer(token_file=token_file)
            # 尝试多种方式获取 vocab_size
            vocab_size = None
            for attr in ("vocab_size", "n_vocab", "num_tokens", "size"):
                if hasattr(self._tokenizer, attr):
                    vocab_size = getattr(self._tokenizer, attr)
                    if callable(vocab_size):
                        vocab_size = vocab_size()
                    break
            if vocab_size is None:
                try:
                    vocab_size = len(self._tokenizer)
                except TypeError:
                    pass
            if vocab_size is None:
                # 尝试从 token_list / tokens 属性推断
                for attr in ("token_list", "tokens", "vocabulary", "vocab"):
                    obj = getattr(self._tokenizer, attr, None)
                    if obj is not None:
                        try:
                            vocab_size = len(obj)
                            break
                        except TypeError:
                            pass
            if vocab_size is None:
                # 从 params 中获取，或使用 ZipVoice 类的默认值 (26)
                vocab_size = getattr(params, "vocab_size", 26)
                print(f"   ⚠️ 无法自动获取 vocab_size，使用默认值: {vocab_size}")
            print(f"   ✅ 分词器已加载 (vocab_size={vocab_size})")

            # 5. 加载特征提取器
            print("   📦 加载特征提取器 (VocosFbank)...")
            self._feature_extractor = VocosFbank()
            print("   ✅ 特征提取器已加载")

            # 6. 构建并加载 TTS 模型
            print(f"   📦 构建 TTS 模型 ({self._model_name})...")
            if self._model_name == "zipvoice_distill":
                model = ZipVoiceDistill(vocab_size=vocab_size)
            else:
                model = ZipVoice(vocab_size=vocab_size)

            # 加载模型权重
            checkpoint_path = getattr(params, "checkpoint", None) or getattr(
                params, "model_path", None
            )
            if checkpoint_path:
                from pathlib import Path

                print(f"   📦 加载模型权重: {checkpoint_path}")
                load_checkpoint(Path(checkpoint_path), model=model)
            else:
                # main() 里可能通过其他方式加载，尝试用 params 里的路径
                # 如果找不到 checkpoint，让 main() 的逻辑自行处理
                print("   ⚠️ 未找到 checkpoint 路径参数，尝试从默认位置加载...")
                # 遍历 params 中所有可能的路径属性
                for attr_name in dir(params):
                    val = getattr(params, attr_name, None)
                    if isinstance(val, str) and (
                        ".pt" in val or ".ckpt" in val or "checkpoint" in val.lower()
                    ):
                        from pathlib import Path

                        if os.path.isfile(val):
                            print(f"   📦 找到权重文件: {attr_name}={val}")
                            load_checkpoint(Path(val), model=model)
                            break

            model = model.to(device).eval()
            self._model = model

            # 7. 保存参数供推理时使用
            self._params = params

            self._use_memory_mode = True
            print(
                f"✅ ZipVoice 模型已完整加载到内存 (device={device}, model={self._model_name})"
            )
            print("   后续推理将直接使用内存中的模型，无需冷启动 🚀")

        except Exception as e:
            import traceback

            print(f"⚠️ 无法加载 ZipVoice 模型到内存: {e}")
            traceback.print_exc()
            print("   将回退到 subprocess 模式（每次推理冷启动，较慢）")
            self._use_memory_mode = False

            # 回退模式：验证 subprocess 是否可用
            self._verify_subprocess()

    def _verify_subprocess(self):
        """验证 ZipVoice 的 subprocess 调用是否可用"""
        try:
            result = subprocess.run(
                [sys.executable, "-c", "import zipvoice; print(zipvoice.__file__)"],
                capture_output=True,
                text=True,
                timeout=30,
            )
            if result.returncode == 0:
                print(
                    f"✅ ZipVoice 包可导入 (subprocess 回退模式): {result.stdout.strip()}"
                )
            else:
                result2 = subprocess.run(
                    [
                        sys.executable,
                        "-c",
                        "from zipvoice.bin import infer_zipvoice; print('ok')",
                    ],
                    capture_output=True,
                    text=True,
                    timeout=30,
                )
                if result2.returncode == 0:
                    print(
                        "✅ ZipVoice 模块可通过 PYTHONPATH 访问 (subprocess 回退模式)"
                    )
                else:
                    print(f"⚠️ ZipVoice 包导入失败: {result.stderr.strip()}")
                    print(f"   回退检查也失败: {result2.stderr.strip()}")
                    raise RuntimeError("ZipVoice 模块不可用，请检查安装")
        except subprocess.TimeoutExpired:
            print("⚠️ ZipVoice 验证超时，继续启动...")
        except RuntimeError:
            raise
        except Exception as e:
            print(f"⚠️ ZipVoice 验证异常: {e}，继续启动...")

    def infer(
        self, prompt_wav: str, text: str, output_path: str, prompt_text: str = None
    ) -> bool:
        """调用 ZipVoice 进行语音合成

        Args:
            prompt_wav: 参考音频路径
            text: 要合成的文本
            output_path: 输出音频路径
            prompt_text: 参考音频的文字转录（可选，不提供则模型自动识别）

        Returns:
            True if success, False otherwise
        """
        if self._use_memory_mode:
            return self._infer_memory(prompt_wav, text, output_path, prompt_text)
        else:
            return self._infer_subprocess(prompt_wav, text, output_path, prompt_text)

    def _infer_memory(
        self, prompt_wav: str, text: str, output_path: str, prompt_text: str = None
    ) -> bool:
        """常驻内存模式推理（直接调用 generate_sentence，无需冷启动）"""
        print(
            f"[推理-内存模式] text={text[:50]}... prompt={os.path.basename(prompt_wav)}"
        )
        start_time = time.time()

        try:
            with self._infer_lock:
                from zipvoice.bin.infer_zipvoice import generate_sentence

                # 从 params 中提取推理超参数（使用默认值兜底）
                params = self._params
                num_step = getattr(params, "num_step", None) or getattr(
                    params, "nfe", 16
                )
                guidance_scale = getattr(params, "guidance_scale", 1.0)
                speed = getattr(params, "speed", 1.0)
                t_shift = getattr(params, "t_shift", 0.5)
                target_rms = getattr(params, "target_rms", 0.1)
                feat_scale = getattr(params, "feat_scale", 0.1)
                sampling_rate = getattr(params, "sampling_rate", 24000)
                max_duration = getattr(params, "max_duration", 100)
                remove_long_sil = getattr(params, "remove_long_sil", False)

                # prompt_text 为空时传空字符串 ""
                # Dockerfile 中已对 add_punctuation 打补丁，能正确处理 None/空字符串
                safe_prompt_text = (
                    prompt_text if prompt_text and prompt_text.strip() else ""
                )

                generate_sentence(
                    save_path=output_path,
                    prompt_text=safe_prompt_text,
                    prompt_wav=prompt_wav,
                    text=text,
                    model=self._model,
                    vocoder=self._vocoder,
                    tokenizer=self._tokenizer,
                    feature_extractor=self._feature_extractor,
                    device=self._torch_device,
                    num_step=num_step,
                    guidance_scale=guidance_scale,
                    speed=speed,
                    t_shift=t_shift,
                    target_rms=target_rms,
                    feat_scale=feat_scale,
                    sampling_rate=sampling_rate,
                    max_duration=max_duration,
                    remove_long_sil=remove_long_sil,
                )

            elapsed = time.time() - start_time
            if os.path.isfile(output_path):
                print(f"[推理-内存模式] ✅ 成功 ({elapsed:.2f}s): {output_path}")
                return True
            else:
                print(f"[推理-内存模式] ❌ 文件未生成: {output_path}")
                return False

        except Exception as e:
            import traceback

            elapsed = time.time() - start_time
            print(f"[推理-内存模式] ❌ 异常 ({elapsed:.2f}s): {e}")
            traceback.print_exc()
            print("   回退到 subprocess 模式执行本次推理")
            return self._infer_subprocess(prompt_wav, text, output_path, prompt_text)

    def _infer_subprocess(
        self, prompt_wav: str, text: str, output_path: str, prompt_text: str = None
    ) -> bool:
        """subprocess 模式推理（回退方案，每次冷启动）"""
        cmd = [
            sys.executable,
            "-m",
            "zipvoice.bin.infer_zipvoice",
            "--model-name",
            self._model_name,
            "--prompt-wav",
            prompt_wav,
            "--text",
            text,
            "--res-wav-path",
            output_path,
        ]

        # --prompt-text 是 ZipVoice 必需参数，未提供时传空字符串（模型会自动识别）
        cmd.extend(["--prompt-text", prompt_text or ""])

        env = os.environ.copy()
        if self._device:
            env["CUDA_VISIBLE_DEVICES"] = self._device.replace("cuda:", "")

        print(f"[推理-subprocess] 执行: {' '.join(cmd)}")
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=120,  # 2 分钟超时
                env=env,
                cwd="/app/zipvoice",
            )
            if result.returncode != 0:
                print(f"[推理-subprocess] 失败 (returncode={result.returncode})")
                print(f"  stdout: {result.stdout[-500:] if result.stdout else '(空)'}")
                print(f"  stderr: {result.stderr[-500:] if result.stderr else '(空)'}")
                return False

            if os.path.isfile(output_path):
                print(f"[推理-subprocess] 成功: {output_path}")
                return True
            else:
                print(f"[推理-subprocess] 命令成功但未生成文件: {output_path}")
                print(f"  stdout: {result.stdout[-500:] if result.stdout else '(空)'}")
                return False

        except subprocess.TimeoutExpired:
            print("[推理-subprocess] 超时 (>120s)")
            return False
        except Exception as e:
            print(f"[推理-subprocess] 异常: {e}")
            return False

    @property
    def model_name(self):
        return self._model_name

    @property
    def mode(self):
        return "内存常驻" if self._use_memory_mode else "subprocess"


# 创建模型管理器（此时不加载模型，仅记录配置）
tts_manager = TTSModelManager(
    model_name=args.model_name,
    device=args.device,
)

# ============================================================
# FastAPI 应用
# ============================================================
app = FastAPI(title="LuxTTS (ZipVoice) API", version="1.0.0")


@app.on_event("startup")
async def startup_event():
    """Worker 进程启动时加载 ZipVoice 模型到内存"""
    print("=" * 50)
    print("  LuxTTS (ZipVoice) API Server 启动中...")
    print(f"  模型: {args.model_name}")
    print("=" * 50)
    print("\n📦 加载 ZipVoice 模型...")
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
    prompt_text: Optional[str] = (
        None  # 参考音频的文字转录（可选，不提供则模型自动识别）
    )
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
        # 通过 subprocess 调用 ZipVoice CLI 进行推理
        success = tts_manager.infer(
            prompt_wav=prompt_path,
            text=req.text,
            output_path=output_path,
            prompt_text=req.prompt_text,
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
