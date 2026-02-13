"""
Index-TTS API Server
为 HX-SayBook 提供 REST API 接口，桥接 Index-TTS 推理引擎。

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
import hashlib
import os
import sys
import tempfile
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
parser = argparse.ArgumentParser(description="Index-TTS API Server")
parser.add_argument("--host", type=str, default="0.0.0.0", help="监听地址")
parser.add_argument("--port", type=int, default=8000, help="监听端口")
parser.add_argument("--model_dir", type=str, default="./checkpoints", help="模型目录")
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
# 初始化 TTS 模型
# ============================================================
print("=" * 50)
print("  Index-TTS API Server 启动中...")
print("=" * 50)

# 检查模型文件
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

from indextts.infer_v2 import IndexTTS2

tts = IndexTTS2(
    cfg_path=os.path.join(args.model_dir, "config.yaml"),
    model_dir=args.model_dir,
    use_fp16=args.fp16,
    device=args.device,
)

print("✅ 模型加载完成")

# ============================================================
# FastAPI 应用
# ============================================================
app = FastAPI(title="Index-TTS API", version="1.0.0")


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
        "name": "Index-TTS API Server",
        "version": "1.0.0",
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
                "id": "index-tts-v2",
                "name": "IndexTTS2",
                "description": "IndexTTS2 语音合成模型",
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
        # 构建推理参数
        kwargs = {
            "spk_audio_prompt": prompt_path,
            "text": req.text,
            "output_path": output_path,
            "verbose": False,
        }

        # 情绪向量优先
        if req.emo_vector is not None:
            kwargs["emo_vector"] = req.emo_vector
        elif req.emo_text:
            kwargs["use_emo_text"] = True
            kwargs["emo_text"] = req.emo_text

        tts.infer(**kwargs)

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
# 启动服务
# ============================================================
if __name__ == "__main__":
    print(f"\n🚀 Index-TTS API Server 运行在 http://{args.host}:{args.port}")
    print(f"   模型目录: {args.model_dir}")
    print(f"   参考音频目录: {PROMPTS_DIR}")
    print()
    uvicorn.run(app, host=args.host, port=args.port)
