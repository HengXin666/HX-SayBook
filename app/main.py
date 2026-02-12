"""
HX-SayBook 后端主入口
基于 SonicVale (音谷) 二次开发
AI 多角色多情绪小说配音平台
"""

import asyncio
import json
import logging
from concurrent.futures import ThreadPoolExecutor

import uvicorn
from fastapi import FastAPI, Depends, WebSocket
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy.orm import Session
from starlette.middleware.cors import CORSMiddleware

from app.core.config import get_data_dir
from app.core.prompts import get_prompt_str
from app.core.tts_runtime import tts_worker
from app.core.ws_manager import manager
from app.db.database import Base, engine, SessionLocal, get_db
from app.entity.emotion_entity import EmotionEntity
from app.entity.strength_entity import StrengthEntity
from app.models.po import *
from app.repositories.llm_provider_repository import LLMProviderRepository
from app.repositories.tts_provider_repository import TTSProviderRepository
from app.routers import (
    project_router,
    chapter_router,
    role_router,
    voice_router,
    llm_provider_router,
    tts_provider_router,
    line_router,
    emotion_router,
    strength_router,
    multi_emotion_voice_router,
    prompt_router,
    batch_router,
)
from app.routers.chapter_router import (
    get_strength_service,
    get_prompt_service,
    get_project_service,
)
from app.routers.emotion_router import get_emotion_service
from app.services.llm_provider_service import LLMProviderService
from app.services.tts_provider_service import TTSProviderService

import os
import sys

# ============================================================
# 项目根路径
# ============================================================
root_path = os.getcwd()
sys.path.append(root_path)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("hx-saybook")

# ============================================================
# FastAPI 实例
# ============================================================
app = FastAPI(
    title="HX-SayBook - AI 多角色小说配音",
    description="基于 SonicVale(音谷) 二次开发的 AI 多角色多情绪小说配音系统",
    version="2.0.0",
)

# CORS - 允许 React dev server 和生产环境
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# 静态文件：挂载音频目录供前端访问
# ============================================================
data_dir = get_data_dir()
os.makedirs(data_dir, exist_ok=True)
app.mount("/static/audio", StaticFiles(directory=data_dir), name="audio")

# ============================================================
# 常量
# ============================================================
WORKERS = 1
QUEUE_CAPACITY = 0

# ============================================================
# 数据库迁移辅助
# ============================================================


def _add_column_if_missing(table: str, column: str, col_def: str = "TEXT"):
    """安全地向表添加列（SQLite 不支持 IF NOT EXISTS）"""
    with engine.connect() as conn:
        result = conn.execute(text(f"PRAGMA table_info({table})"))
        columns = [row[1] for row in result.fetchall()]
        if column not in columns:
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {col_def}"))
            conn.commit()
            logger.info(f"已添加列 {table}.{column}")


def _run_migrations():
    """执行数据库迁移"""
    _add_column_if_missing("projects", "prompt_id", "INTEGER")
    _add_column_if_missing("lines", "is_done", "INTEGER DEFAULT 0")
    _add_column_if_missing("projects", "is_precise_fill", "INTEGER DEFAULT 0")
    _add_column_if_missing("projects", "project_root_path", "TEXT")

    # custom_params 需要特殊处理：填入默认值
    with engine.begin() as conn:
        result = conn.execute(text("PRAGMA table_info(llm_provider)"))
        columns = [row[1] for row in result.fetchall()]
        if "custom_params" not in columns:
            conn.execute(text("ALTER TABLE llm_provider ADD COLUMN custom_params TEXT"))
            default_json = json.dumps(
                {
                    "response_format": {"type": "json_object"},
                    "temperature": 0.7,
                    "top_p": 0.9,
                },
                ensure_ascii=False,
            )
            conn.execute(
                text("UPDATE llm_provider SET custom_params = :val"),
                {"val": default_json},
            )
            logger.info("已添加 custom_params 列并写入默认值")


# ============================================================
# 依赖注入辅助
# ============================================================


def get_tts_service(db: Session = Depends(get_db)) -> TTSProviderService:
    return TTSProviderService(TTSProviderRepository(db))


# ============================================================
# 生命周期
# ============================================================


@app.on_event("startup")
async def startup_event():
    # 1) 建表
    try:
        Base.metadata.create_all(bind=engine)
    except Exception as e:
        logger.exception("数据库建表失败: %s", e)

    # 2) 迁移
    try:
        _run_migrations()
    except Exception as e:
        logger.exception("数据库迁移失败: %s", e)

    # 3) 初始化 TTS 队列
    try:
        app.state.tts_queue = asyncio.Queue(maxsize=QUEUE_CAPACITY)
        app.state.tts_executor = ThreadPoolExecutor(max_workers=WORKERS)
        app.state.tts_workers = [
            asyncio.create_task(tts_worker(app)) for _ in range(WORKERS)
        ]
    except Exception as e:
        logger.exception("初始化队列/线程池失败: %s", e)

    # 4) 初始化默认数据
    db = SessionLocal()
    try:
        # TTS Provider
        try:
            tts_service = get_tts_service(db)
            tts_service.create_default_tts_provider()
        except Exception as e:
            logger.debug("默认 TTS provider: %s", e)

        # 情绪
        try:
            emotion_service = get_emotion_service(db)
            for name in [
                "高兴",
                "生气",
                "伤心",
                "害怕",
                "厌恶",
                "低落",
                "惊喜",
                "平静",
            ]:
                try:
                    emotion_service.create_emotion(EmotionEntity(name=name))
                except Exception:
                    pass
        except Exception as e:
            logger.warning("情绪初始化: %s", e)

        # 强度
        try:
            strength_service = get_strength_service(db)
            for name in ["微弱", "稍弱", "中等", "较强", "强烈"]:
                try:
                    strength_service.create_strength(StrengthEntity(name=name))
                except Exception:
                    pass
        except Exception as e:
            logger.warning("强度初始化: %s", e)

        # 默认提示词
        try:
            prompt_service = get_prompt_service(db)
            if not prompt_service.get_all_prompts():
                prompt_service.create_default_prompt()
            else:
                default_prompt = prompt_service.get_prompt_by_name("默认拆分台词提示词")
                if not default_prompt:
                    prompt_service.create_default_prompt()
                else:
                    default_prompt.content = get_prompt_str()
                    prompt_service.update_prompt(
                        default_prompt.id, default_prompt.__dict__
                    )
        except Exception as e:
            logger.warning("默认提示词: %s", e)

        # 兼容旧版本项目路径
        try:
            project_service = get_project_service(db)
            for project in project_service.get_all_projects():
                if not project.project_root_path:
                    project.project_root_path = get_data_dir()
                    project_service.update_project(project.id, project.__dict__)
        except Exception as e:
            logger.warning("项目路径兼容: %s", e)

    except Exception as e:
        logger.exception("默认数据初始化异常: %s", e)
    finally:
        db.close()

    logger.info("HX-SayBook 后端启动完成 ✅")


@app.on_event("shutdown")
async def shutdown_event():
    for t in getattr(app.state, "tts_workers", []):
        t.cancel()
    ex = getattr(app.state, "tts_executor", None)
    if ex:
        ex.shutdown(wait=False, cancel_futures=True)
    logger.info("HX-SayBook 后端已关闭")


# ============================================================
# 注册路由
# ============================================================
app.include_router(project_router.router)
app.include_router(chapter_router.router)
app.include_router(role_router.router)
app.include_router(voice_router.router)
app.include_router(llm_provider_router.router)
app.include_router(tts_provider_router.router)
app.include_router(line_router.router)
app.include_router(emotion_router.router)
app.include_router(strength_router.router)
app.include_router(multi_emotion_voice_router.router)
app.include_router(prompt_router.router)
app.include_router(batch_router.router)


# ============================================================
# 健康检查
# ============================================================
@app.get("/", tags=["System"])
def read_root():
    return {"msg": "HX-SayBook 后端服务运行中！", "version": "2.0.0"}


@app.get("/api/health", tags=["System"])
def health_check():
    return {"status": "ok", "service": "HX-SayBook"}


# ============================================================
# WebSocket
# ============================================================
@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await manager.connect(ws)
    try:
        while True:
            msg_text = await ws.receive_text()
            try:
                data = json.loads(msg_text)
            except Exception:
                data = {}

            if data.get("type") == "ping":
                await ws.send_text(json.dumps({"type": "pong"}))
                continue
    except Exception:
        manager.disconnect(ws)


# ============================================================
# 入口
# ============================================================
if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8200,
        reload=True,
        log_config=None,
    )
