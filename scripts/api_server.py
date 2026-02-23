"""
Index-TTS 2.5 API Server
为 HX-SayBook 提供 REST API 接口，桥接 Index-TTS 2.5 推理引擎。

Index-TTS 2.5 相比 2.0 的主要改进：
  - Zipformer 替代 U-DiT（S2M 模块），延迟从 0.078s 降至 0.017s
  - 语义编码帧率从 50Hz 降至 25Hz，Token 序列长度减半
  - RTF 从 0.232 提升至 0.119（快 2.28 倍）
  - 新增多语言支持（中/英/日/西班牙语）
  - 新增 GRPO 强化学习优化发音准确性
  - 新增语速控制参数

接口列表:
  GET  /              - 服务信息（用于连接测试）
  GET  /v1/models     - 获取模型信息
  POST /v2/synthesize - 语音合成
  GET  /v1/check/audio - 检查参考音频是否存在
  POST /v1/upload_audio - 上传参考音频

启动方式:
  python api_server.py --host 0.0.0.0 --port 8000
"""

import argparse
import gc
import hashlib
import os
import sys
import tempfile
import threading
import time
import warnings

warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", category=UserWarning)

# 确保能导入 indextts 模块
current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.append(current_dir)
sys.path.append(os.path.join(current_dir, "indextts"))

import uvicorn
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
from typing import List, Optional


# ============================================================
# 命令行参数
# ============================================================
parser = argparse.ArgumentParser(description="Index-TTS 2.5 API Server")
parser.add_argument("--host", type=str, default="0.0.0.0", help="监听地址")
parser.add_argument("--port", type=int, default=8000, help="监听端口")
parser.add_argument(
    "--model_dir", type=str, default="./checkpoints", help="模型目录（中文模型）"
)
parser.add_argument(
    "--ja_model_dir", type=str, default=None, help="日语模型目录（默认为 model_dir/ja）"
)
parser.add_argument("--fp16", action="store_true", default=False, help="使用 FP16 推理")
parser.add_argument("--device", type=str, default=None, help="推理设备 (cuda:0 / cpu)")
args = parser.parse_args()

# 日语模型目录：默认在 model_dir/ja 下
if args.ja_model_dir is None:
    args.ja_model_dir = os.path.join(args.model_dir, "ja")

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
# 初始化 TTS 模型（切换模式：同一时间只加载一个语言的模型）
# ============================================================
print("=" * 50)
print("  Index-TTS 2.5 API Server 启动中...")
print("  模式: 单模型切换（节省显存）")
print("  改进: Zipformer S2M / 25Hz 语义编码 / GRPO 优化")
print("=" * 50)

# 检查中文模型文件
required_files = [
    "bpe.model",
    "gpt.pth",
    "config.yaml",
    "s2mel.pth",
    "wav2vec2bert_stats.pt",
]
for f in required_files:
    fpath = os.path.join(args.model_dir, f)
    if not os.path.exists(fpath):
        print(f"❌ 缺少模型文件: {fpath}")
        print(f"   请参考 https://github.com/index-tts/index-tts#模型下载 下载模型")
        sys.exit(1)

# 检查日语模型文件是否存在
ja_model_dir = args.ja_model_dir
# 支持实际下载的日语模型文件名格式
ja_available = False
if os.path.exists(ja_model_dir):
    # 检查是否有日语模型文件（支持多种可能的文件名）
    bpe_files = ["japanese_bpe.model", "bpe.model"]
    gpt_files = ["model_jp_163000.pth", "model_step36000.pth", "gpt.pth"]
    config_files = ["config.yaml"]

    # 检查文件是否存在
    has_bpe = any(os.path.exists(os.path.join(ja_model_dir, f)) for f in bpe_files)
    has_gpt = any(os.path.exists(os.path.join(ja_model_dir, f)) for f in gpt_files)
    has_config = any(
        os.path.exists(os.path.join(ja_model_dir, f)) for f in config_files
    )

    ja_available = has_bpe and has_gpt and has_config

    if ja_available:
        print(f"✅ 日语模型文件就绪 ({ja_model_dir})")
        print(
            f"   BPE 文件: {' | '.join([f for f in bpe_files if os.path.exists(os.path.join(ja_model_dir, f))])}"
        )
        print(
            f"   GPT 文件: {' | '.join([f for f in gpt_files if os.path.exists(os.path.join(ja_model_dir, f))])}"
        )
        print(
            f"   配置文件: {' | '.join([f for f in config_files if os.path.exists(os.path.join(ja_model_dir, f))])}"
        )
if ja_available:
    print(f"✅ 日语模型文件就绪 ({ja_model_dir})")
else:
    print(f"⚠️  未找到日语模型文件 ({ja_model_dir})，日语合成功能不可用")
    print(f"   请从 https://huggingface.co/Jmica/IndexTTS-2-Japanese 下载模型")

from indextts.infer_v2 import IndexTTS2

# 尝试导入 2.5 版本标识（如果可用）
try:
    from indextts import __version__ as indextts_version
except ImportError:
    indextts_version = "2.x"


class TTSModelManager:
    """TTS 模型管理器：同一时间只加载一个语言的模型，按需切换以节省 GPU 显存"""

    def __init__(self):
        self._tts = None  # 当前加载的 IndexTTS2 实例
        self._current_lang = None  # 当前加载的语言: "zh" / "ja"
        self._lock = threading.Lock()  # 线程安全锁

    def _unload(self):
        """卸载当前模型，释放 GPU 显存"""
        if self._tts is not None:
            lang_name = "中文" if self._current_lang == "zh" else "日语"
            print(f"🔄 卸载{lang_name}模型...")
            del self._tts
            self._tts = None
            self._current_lang = None
            gc.collect()
            try:
                import torch

                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except ImportError:
                pass
            print(f"   已释放显存")

    def _load(self, lang: str):
        """加载指定语言的模型"""
        if lang == "ja":
            model_dir = ja_model_dir
            cfg_path = os.path.join(ja_model_dir, "config.yaml")
            lang_name = "日语"

            # 日语模型文件名映射
            model_files = {
                "bpe.model": "japanese_bpe.model",
                "gpt.pth": "model_jp_163000.pth",  # 优先使用较新的模型
            }

            # 检查实际存在的文件
            for expected, actual in model_files.items():
                actual_path = os.path.join(model_dir, actual)
                if os.path.exists(actual_path):
                    # 创建符号链接或复制文件（如果不存在标准文件名）
                    expected_path = os.path.join(model_dir, expected)
                    if not os.path.exists(expected_path):
                        try:
                            os.symlink(actual, expected_path)
                            print(f"🔗 创建符号链接: {expected} -> {actual}")
                        except OSError:
                            # 如果符号链接失败，尝试复制文件
                            import shutil

                            shutil.copy2(actual_path, expected_path)
                            print(f"📄 复制文件: {actual} -> {expected}")

        else:
            model_dir = args.model_dir
            cfg_path = os.path.join(args.model_dir, "config.yaml")
            lang_name = "中文"

        print(f"📦 加载{lang_name}模型...")
        self._tts = IndexTTS2(
            cfg_path=cfg_path,
            model_dir=model_dir,
            use_fp16=args.fp16,
            device=args.device,
        )
        self._current_lang = lang
        print(f"✅ {lang_name}模型加载完成 (版本: {indextts_version})")

    def get_tts(self, lang: str) -> IndexTTS2:
        """
        获取指定语言的 TTS 实例。
        如果当前已加载相同语言的模型则直接返回；否则卸载旧模型并加载新模型。
        """
        with self._lock:
            if self._current_lang == lang and self._tts is not None:
                return self._tts

            # 需要切换模型
            if self._tts is not None:
                self._unload()
            self._load(lang)
            return self._tts

    @property
    def current_lang(self):
        return self._current_lang


# 初始化模型管理器，启动时默认加载中文模型
tts_manager = TTSModelManager()
print(f"\n📦 初始加载中文模型... (Index-TTS {indextts_version})")
tts_manager.get_tts("zh")

# 兼容旧代码
tts = tts_manager

# ============================================================
# FastAPI 应用
# ============================================================
app = FastAPI(title="Index-TTS 2.5 API", version="2.5.0")


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
        "name": "Index-TTS 2.5 API Server",
        "version": "2.5.0",
        "engine_version": indextts_version,
        "features": [
            "Zipformer S2M (4.6x faster)",
            "25Hz semantic codec (2x shorter tokens)",
            "GRPO pronunciation optimization",
            "Multi-language (zh/en/ja/es)",
            "Speed control",
        ],
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
                "id": "index-tts-v2.5",
                "name": "IndexTTS2.5",
                "version": indextts_version,
                "description": "IndexTTS 2.5 语音合成模型 (Zipformer S2M, 25Hz 语义编码, RTF 0.119)",
                "features": {
                    "s2m_backbone": "Zipformer",
                    "semantic_fps": 25,
                    "rtf": 0.119,
                    "languages": ["zh", "en", "ja", "es"],
                    "emotion_control": True,
                    "speed_control": True,
                },
            }
        ]
    }


# ============================================================
# POST /v2/synthesize — 语音合成
# ============================================================
class SynthesizeRequest(BaseModel):
    text: str
    audio_path: str  # 参考音频文件名（上传时的原始路径或文件名）
    emo_text: Optional[str] = None
    emo_vector: Optional[List[float]] = None
    language: Optional[str] = None  # 语言: "zh"(中文) / "ja"(日语) / "en"(英语) / "es"(西班牙语), 默认自动检测
    speed: Optional[float] = None  # 语速控制: 0.5~2.0, 默认 1.0（2.5 新增）


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
        # 根据语言选择/切换模型
        language = req.language or "zh"
        if language == "ja" and not ja_available:
            return JSONResponse(
                status_code=400,
                content={
                    "error": "日语模型文件不存在，请先下载日语模型到 checkpoints/ja 目录"
                },
            )
        if language not in ("zh", "ja"):
            print(f"[LANG] 未知语言 '{language}'，回退到中文模型")
            language = "zh"

        # 获取当前语言的 TTS 实例（如需切换会自动卸载旧模型 + 加载新模型）
        if language != tts_manager.current_lang:
            lang_name = "日语" if language == "ja" else "中文"
            print(f"[LANG] 切换到{lang_name}模型...")
        active_tts = tts_manager.get_tts(language)

        # 构建推理参数
        kwargs = {
            "spk_audio_prompt": prompt_path,
            "text": req.text,
            "output_path": output_path,
            "verbose": False,
        }

        # 语速控制（Index-TTS 2.5 新增）
        if req.speed is not None and req.speed != 1.0:
            kwargs["speed"] = max(0.5, min(2.0, req.speed))
            print(f"[SPEED] 语速: {kwargs['speed']}")

        # 情绪向量优先（需要先归一化：应用偏置因子 + 总和约束）
        if req.emo_vector is not None:
            raw_vec = req.emo_vector
            normed_vec = active_tts.normalize_emo_vec(list(raw_vec), apply_bias=True)
            print(
                f"[EMO] 原始向量: {[round(v,4) for v in raw_vec]}, 总和={sum(raw_vec):.4f}"
            )
            print(
                f"[EMO] 归一化后: {[round(v,4) for v in normed_vec]}, 总和={sum(normed_vec):.4f}"
            )
            kwargs["emo_vector"] = normed_vec
        elif req.emo_text:
            kwargs["use_emo_text"] = True
            kwargs["emo_text"] = req.emo_text

        active_tts.infer(**kwargs)

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
        "engine": "Index-TTS 2.5",
    }


# ============================================================
# 启动服务
# ============================================================
if __name__ == "__main__":
    print(f"\n🚀 Index-TTS 2.5 API Server 运行在 http://{args.host}:{args.port}")
    print(f"   模式: 单模型切换（节省显存）")
    print(f"   引擎版本: {indextts_version}")
    print(f"   中文模型目录: {args.model_dir}")
    print(
        f"   日语模型目录: {args.ja_model_dir} ({'✅ 可用' if ja_available else '❌ 不可用'})"
    )
    print(f"   当前加载: {tts_manager.current_lang}")
    print(f"   参考音频目录: {PROMPTS_DIR}")
    print(f"   改进: Zipformer S2M / 25Hz 语义编码 / GRPO / 语速控制")
    print()
    uvicorn.run(app, host=args.host, port=args.port)
