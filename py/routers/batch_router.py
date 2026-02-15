"""
批量处理路由 - 支持批量LLM解析和批量TTS配音
所有操作通过 WebSocket 推送实时日志和进度
"""

import asyncio
import json
import logging
import os
import random
import traceback
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from py.core.config import get_data_dir
from py.core.response import Res
from py.core.text_correct_engine import TextCorrectorFinal
from py.core.ws_manager import manager
from py.db.database import get_db, SessionLocal
from py.dto.line_dto import LineInitDTO
from py.repositories.chapter_repository import ChapterRepository
from py.repositories.emotion_repository import EmotionRepository
from py.repositories.line_repository import LineRepository
from py.repositories.llm_provider_repository import LLMProviderRepository
from py.repositories.project_repository import ProjectRepository
from py.repositories.prompt_repository import PromptRepository
from py.repositories.role_repository import RoleRepository
from py.repositories.strength_repository import StrengthRepository
from py.repositories.tts_provider_repository import TTSProviderRepository
from py.repositories.voice_repository import VoiceRepository
from py.services.chapter_service import ChapterService
from py.services.emotion_service import EmotionService
from py.services.line_service import LineService
from py.services.project_service import ProjectService
from py.services.prompt_service import PromptService
from py.services.role_service import RoleService
from py.services.strength_service import StrengthService
from py.services.voice_service import VoiceService
from py.services.multi_emotion_voice_service import MultiEmotionVoiceService
from py.repositories.multi_emotion_voice_repository import MultiEmotionVoiceRepository
from py.core.tts_runtime import emotion_text_to_vector

logger = logging.getLogger("hx-saybook.batch")

router = APIRouter(prefix="/batch", tags=["Batch"])


# ============================================================
# 请求 DTO
# ============================================================


class BatchLLMRequest(BaseModel):
    """批量 LLM 解析请求"""

    project_id: int
    chapter_ids: List[int]  # 支持选择章节范围
    concurrency: int = 1  # 并发数，默认1，范围1~10
    skip_parsed: bool = True  # 跳过已解析过的章节（默认开启）


class BatchTTSRequest(BaseModel):
    """批量 TTS 配音请求"""

    project_id: int
    chapter_ids: List[int]
    speed: float = 1.0  # 全局速度调节


class VoicePreviewRequest(BaseModel):
    """语音预览请求"""

    text: str
    voice_id: int
    tts_provider_id: int
    emotion_name: str = "平静"
    strength_name: str = "中等"
    speed: float = 1.0
    language: Optional[str] = None  # 语言: "zh"(中文) / "ja"(日语)


class VoiceDebugRequest(BaseModel):
    """语音调试请求"""

    text: str
    voice_id: int
    tts_provider_id: int
    emotion_name: str = "平静"
    strength_name: str = "中等"
    speed: float = 1.0
    language: Optional[str] = None  # 语言: "zh"(中文) / "ja"(日语)


# ============================================================
# 辅助依赖注入
# ============================================================


def _get_services(db: Session):
    """一次性获取所有所需 service"""
    return {
        "chapter": ChapterService(ChapterRepository(db)),
        "line": LineService(
            LineRepository(db), RoleRepository(db), TTSProviderRepository(db)
        ),
        "role": RoleService(RoleRepository(db)),
        "emotion": EmotionService(EmotionRepository(db)),
        "strength": StrengthService(StrengthRepository(db)),
        "prompt": PromptService(PromptRepository(db)),
        "project": ProjectService(ProjectRepository(db)),
        "voice": VoiceService(VoiceRepository(db), MultiEmotionVoiceRepository(db)),
        "multi_emotion": MultiEmotionVoiceService(MultiEmotionVoiceRepository(db)),
    }


# ============================================================
# 批量 LLM 任务管理（支持并发 + 取消）
# ============================================================

# 存储运行中的批量LLM任务: project_id -> {"cancel_event": asyncio.Event, "task": asyncio.Task}
_batch_llm_tasks: dict = {}


@router.post(
    "/llm-parse",
    response_model=Res,
    summary="批量LLM解析章节",
    description="选择章节范围，批量进行LLM台词拆分，支持并发和取消，通过WebSocket推送日志和进度",
)
async def batch_llm_parse(req: BatchLLMRequest):
    """批量解析多个章节，通过 WS 推送实时进度"""
    # 如果该项目已有运行中的任务，拒绝重复启动
    if req.project_id in _batch_llm_tasks:
        return Res(code=400, message="该项目已有批量LLM任务在运行中，请先取消后再重试")

    concurrency = max(1, min(10, req.concurrency))  # 限制并发范围 1~10
    cancel_event = asyncio.Event()
    task = asyncio.create_task(
        _do_batch_llm(
            req.project_id, req.chapter_ids, concurrency, cancel_event, req.skip_parsed
        )
    )
    _batch_llm_tasks[req.project_id] = {"cancel_event": cancel_event, "task": task}

    # 任务结束后自动清理
    def _cleanup(fut):
        _batch_llm_tasks.pop(req.project_id, None)

    task.add_done_callback(_cleanup)

    return Res(
        code=200,
        message="批量LLM解析任务已启动",
        data={"chapter_count": len(req.chapter_ids), "concurrency": concurrency},
    )


@router.get(
    "/llm-status",
    response_model=Res,
    summary="查询批量LLM任务状态",
    description="查询指定项目是否有正在运行的批量LLM任务",
)
async def batch_llm_status(project_id: int):
    """查询批量LLM任务是否正在运行"""
    task_info = _batch_llm_tasks.get(project_id)
    if not task_info:
        return Res(code=200, message="无运行中的任务", data={"running": False})

    return Res(
        code=200,
        message="任务运行中",
        data={
            "running": True,
            "cancelled": task_info["cancel_event"].is_set(),
        },
    )


@router.post(
    "/llm-cancel",
    response_model=Res,
    summary="取消批量LLM解析",
    description="取消正在运行的批量LLM解析任务",
)
async def batch_llm_cancel(project_id: int):
    """取消正在运行的批量LLM任务"""
    task_info = _batch_llm_tasks.get(project_id)
    if not task_info:
        return Res(code=404, message="没有正在运行的批量LLM任务")

    task_info["cancel_event"].set()
    logger.info(f"批量LLM任务取消信号已发送: project_id={project_id}")
    return Res(code=200, message="取消信号已发送，任务将在当前章节处理完成后停止")


async def _process_single_chapter_async(
    project_id: int,
    chapter_id: int,
    idx: int,
    total: int,
    cancel_event: asyncio.Event,
    done_counter: dict,
    skip_parsed: bool = False,
):
    """
    纯异步处理单个章节的LLM解析 —— 直接在事件循环中运行，不阻塞。
    LLM 调用使用 AsyncOpenAI，所有网络 IO 均为非阻塞。
    当 skip_parsed=True 时，若章节已有台词数据则自动跳过。
    """

    async def _broadcast(msg: dict):
        await manager.broadcast(msg)

    # 检查是否已取消
    if cancel_event.is_set():
        await _broadcast(
            {
                "event": "batch_llm_progress",
                "project_id": project_id,
                "chapter_id": chapter_id,
                "current": done_counter["done"],
                "total": total,
                "progress": round((done_counter["done"] / total) * 100),
                "status": "cancelled",
                "log": f"⏹️ 章节 {chapter_id} 已取消",
            }
        )
        return

    db = SessionLocal()
    try:
        services = _get_services(db)
        chapter_svc = services["chapter"]
        line_svc = services["line"]
        role_svc = services["role"]
        emotion_svc = services["emotion"]
        strength_svc = services["strength"]
        prompt_svc = services["prompt"]
        project_svc = services["project"]

        progress = round((done_counter["done"] / total) * 100)

        await _broadcast(
            {
                "event": "batch_llm_progress",
                "project_id": project_id,
                "chapter_id": chapter_id,
                "current": done_counter["done"] + 1,
                "total": total,
                "progress": progress,
                "status": "processing",
                "log": f"📖 开始解析章节 {chapter_id} ({done_counter['done'] + 1}/{total})",
            }
        )

        chapter = chapter_svc.get_chapter(chapter_id)
        if not chapter or not chapter.text_content:
            done_counter["done"] += 1
            await _broadcast(
                {
                    "event": "batch_llm_progress",
                    "project_id": project_id,
                    "chapter_id": chapter_id,
                    "current": done_counter["done"],
                    "total": total,
                    "progress": round((done_counter["done"] / total) * 100),
                    "status": "skipped",
                    "log": f"⚠️ 章节 {chapter_id} 内容为空，已跳过",
                }
            )
            return

        # 跳过已解析过的章节（有台词数据 = 已完成全部段落的LLM解析并写入）
        if skip_parsed:
            existing_lines = line_svc.get_all_lines(chapter_id)
            if len(existing_lines) > 0:
                done_counter["done"] += 1
                await _broadcast(
                    {
                        "event": "batch_llm_progress",
                        "project_id": project_id,
                        "chapter_id": chapter_id,
                        "current": done_counter["done"],
                        "total": total,
                        "progress": round((done_counter["done"] / total) * 100),
                        "status": "skipped",
                        "log": f"⏭️ 章节 {chapter_id} 已有 {len(existing_lines)} 条台词，跳过重复解析",
                    }
                )
                return

        # 拆分文本
        try:
            contents = chapter_svc.split_text(chapter_id, 1500)
            await _broadcast(
                {
                    "event": "batch_llm_log",
                    "project_id": project_id,
                    "chapter_id": chapter_id,
                    "log": f"📝 章节文本划分为 {len(contents)} 段",
                }
            )
        except Exception as e:
            done_counter["done"] += 1
            await _broadcast(
                {
                    "event": "batch_llm_progress",
                    "project_id": project_id,
                    "chapter_id": chapter_id,
                    "current": done_counter["done"],
                    "total": total,
                    "progress": round((done_counter["done"] / total) * 100),
                    "status": "error",
                    "log": f"❌ 章节拆分失败: {e}",
                }
            )
            return

        # 获取角色、情绪、强度
        roles = role_svc.get_all_roles(project_id)
        roles_set = set(role.name for role in roles)
        emotions = emotion_svc.get_all_emotions()
        strengths = strength_svc.get_all_strengths()
        emotion_names = [e.name for e in emotions]
        strength_names = [s.name for s in strengths]
        emotions_dict = {e.name: e.id for e in emotions}
        strengths_dict = {s.name: s.id for s in strengths}

        project = project_svc.get_project(project_id)
        is_precise_fill = project.is_precise_fill

        if not all(
            [project.tts_provider_id, project.llm_provider_id, project.llm_model]
        ):
            done_counter["done"] += 1
            await _broadcast(
                {
                    "event": "batch_llm_progress",
                    "project_id": project_id,
                    "chapter_id": chapter_id,
                    "current": done_counter["done"],
                    "total": total,
                    "progress": round((done_counter["done"] / total) * 100),
                    "status": "error",
                    "log": "❌ 项目缺少 TTS/LLM/Model 配置",
                }
            )
            return

        prompt = prompt_svc.get_prompt(project.prompt_id) if project.prompt_id else None
        if not prompt:
            done_counter["done"] += 1
            await _broadcast(
                {
                    "event": "batch_llm_progress",
                    "project_id": project_id,
                    "chapter_id": chapter_id,
                    "current": done_counter["done"],
                    "total": total,
                    "progress": round((done_counter["done"] / total) * 100),
                    "status": "error",
                    "log": "❌ 提示词不存在",
                }
            )
            return

        # 逐段解析（异步非阻塞），带暂停重试逻辑
        all_line_data = []
        parse_success = True
        MAX_SEG_RETRIES = 3  # 每段最多重试次数

        from py.core.llm_engine import _is_rate_limit_error

        for seg_idx, content in enumerate(contents):
            # 每段解析前检查取消信号
            if cancel_event.is_set():
                done_counter["done"] += 1
                await _broadcast(
                    {
                        "event": "batch_llm_progress",
                        "project_id": project_id,
                        "chapter_id": chapter_id,
                        "current": done_counter["done"],
                        "total": total,
                        "progress": round((done_counter["done"] / total) * 100),
                        "status": "cancelled",
                        "log": f"⏹️ 章节 {chapter_id} 解析被取消",
                    }
                )
                return

            seg_success = False
            for retry_idx in range(MAX_SEG_RETRIES):
                # 重试前也检查取消信号
                if cancel_event.is_set():
                    done_counter["done"] += 1
                    return

                retry_hint = f"（第 {retry_idx + 1} 次重试）" if retry_idx > 0 else ""
                await _broadcast(
                    {
                        "event": "batch_llm_log",
                        "project_id": project_id,
                        "chapter_id": chapter_id,
                        "log": f"🔄 解析第 {seg_idx + 1}/{len(contents)} 段...{retry_hint}",
                    }
                )

                try:
                    # 使用异步非阻塞 LLM 调用
                    result = await chapter_svc.para_content_async(
                        prompt.content,
                        chapter_id,
                        content,
                        list(roles_set),
                        emotion_names,
                        strength_names,
                        is_precise_fill,
                    )

                    if not result["success"]:
                        error_msg = result.get("message", "未知错误")
                        # 判断是否为请求频繁类错误，如果是则暂停后重试
                        if (
                            _is_rate_limit_error(Exception(error_msg))
                            and retry_idx < MAX_SEG_RETRIES - 1
                        ):
                            wait_time = min(
                                15 * (2**retry_idx), 120
                            ) + random.uniform(1, 5)
                            await _broadcast(
                                {
                                    "event": "batch_llm_log",
                                    "project_id": project_id,
                                    "chapter_id": chapter_id,
                                    "log": f"⏳ 段 {seg_idx + 1} 请求频繁: {error_msg}，等待 {wait_time:.0f}s 后重试...",
                                }
                            )
                            await asyncio.sleep(wait_time)
                            continue  # 重试当前段
                        else:
                            await _broadcast(
                                {
                                    "event": "batch_llm_log",
                                    "project_id": project_id,
                                    "chapter_id": chapter_id,
                                    "log": f"❌ 段 {seg_idx + 1} 解析失败: {error_msg}",
                                }
                            )
                            parse_success = False
                            break  # 跳出重试循环

                    else:
                        lines_data = result["data"]
                        for ld in lines_data:
                            roles_set.add(ld.role_name)
                        all_line_data.extend(lines_data)

                        await _broadcast(
                            {
                                "event": "batch_llm_log",
                                "project_id": project_id,
                                "chapter_id": chapter_id,
                                "log": f"✅ 段 {seg_idx + 1} 解析完成，获得 {len(lines_data)} 条台词",
                            }
                        )
                        seg_success = True
                        break  # 解析成功，跳出重试循环

                except Exception as e:
                    logger.error(f"解析失败: {e}\n{traceback.format_exc()}")
                    # 判断是否为请求频繁类错误
                    if _is_rate_limit_error(e) and retry_idx < MAX_SEG_RETRIES - 1:
                        wait_time = min(15 * (2**retry_idx), 120) + random.uniform(1, 5)
                        await _broadcast(
                            {
                                "event": "batch_llm_log",
                                "project_id": project_id,
                                "chapter_id": chapter_id,
                                "log": f"⏳ 段 {seg_idx + 1} 请求频繁: {e}，等待 {wait_time:.0f}s 后重试...",
                            }
                        )
                        await asyncio.sleep(wait_time)
                        continue  # 重试当前段
                    else:
                        await _broadcast(
                            {
                                "event": "batch_llm_log",
                                "project_id": project_id,
                                "chapter_id": chapter_id,
                                "log": f"❌ 段 {seg_idx + 1} 解析异常: {e}",
                            }
                        )
                        parse_success = False
                        break  # 跳出重试循环

            # 如果当前段所有重试都失败了，终止后续段的解析
            if not seg_success and not parse_success:
                break

        if parse_success and all_line_data:
            # 写入数据库
            try:
                # 先清除该章节的旧台词（避免重新解析时台词重复叠加）
                existing_lines = line_svc.get_all_lines(chapter_id)
                if len(existing_lines) > 0:
                    line_svc.delete_all_lines(chapter_id)
                    await _broadcast(
                        {
                            "event": "batch_llm_log",
                            "project_id": project_id,
                            "chapter_id": chapter_id,
                            "log": f"🗑️ 已清除章节 {chapter_id} 的 {len(existing_lines)} 条旧台词",
                        }
                    )

                audio_path = os.path.join(
                    project.project_root_path,
                    str(project_id),
                    str(chapter_id),
                    "audio",
                )
                os.makedirs(audio_path, exist_ok=True)
                line_svc.update_init_lines(
                    all_line_data,
                    project_id,
                    chapter_id,
                    emotions_dict,
                    strengths_dict,
                    audio_path,
                )

                done_counter["done"] += 1
                await _broadcast(
                    {
                        "event": "batch_llm_progress",
                        "project_id": project_id,
                        "chapter_id": chapter_id,
                        "current": done_counter["done"],
                        "total": total,
                        "progress": round((done_counter["done"] / total) * 100),
                        "status": "done",
                        "log": f"✅ 章节 {chapter_id} 解析完成，共 {len(all_line_data)} 条台词",
                    }
                )
            except Exception as e:
                done_counter["done"] += 1
                await _broadcast(
                    {
                        "event": "batch_llm_progress",
                        "project_id": project_id,
                        "chapter_id": chapter_id,
                        "current": done_counter["done"],
                        "total": total,
                        "progress": round((done_counter["done"] / total) * 100),
                        "status": "error",
                        "log": f"❌ 写入数据库失败: {e}",
                    }
                )
        else:
            done_counter["done"] += 1
            await _broadcast(
                {
                    "event": "batch_llm_progress",
                    "project_id": project_id,
                    "chapter_id": chapter_id,
                    "current": done_counter["done"],
                    "total": total,
                    "progress": round((done_counter["done"] / total) * 100),
                    "status": "error",
                    "log": f"❌ 章节 {chapter_id} 解析失败",
                }
            )

    except Exception as e:
        logger.error(f"批量LLM处理异常: {e}\n{traceback.format_exc()}")
        done_counter["done"] += 1
        await _broadcast(
            {
                "event": "batch_llm_progress",
                "project_id": project_id,
                "chapter_id": chapter_id,
                "current": done_counter["done"],
                "total": total,
                "progress": 0,
                "status": "error",
                "log": f"❌ 未知错误: {e}",
            }
        )
    finally:
        db.close()


async def _do_batch_llm(
    project_id: int,
    chapter_ids: List[int],
    concurrency: int,
    cancel_event: asyncio.Event,
    skip_parsed: bool = True,
):
    """后台执行批量LLM解析（支持并发 + 取消，纯协程无线程池）"""
    total = len(chapter_ids)
    semaphore = asyncio.Semaphore(concurrency)
    # 使用 dict 做计数器以便在协程间共享
    done_counter = {"done": 0}

    async def _sem_wrapper(chapter_id: int, idx: int):
        # 在等待信号量之前就检查取消，避免排队的任务逐个走取消流程
        if cancel_event.is_set():
            return
        async with semaphore:
            if cancel_event.is_set():
                return
            await _process_single_chapter_async(
                project_id,
                chapter_id,
                idx,
                total,
                cancel_event,
                done_counter,
                skip_parsed,
            )
            # 避免过快请求LLM
            await asyncio.sleep(0.3)

    # 创建所有任务
    tasks = [
        asyncio.create_task(_sem_wrapper(cid, idx))
        for idx, cid in enumerate(chapter_ids)
    ]

    # 等待完成或取消
    # 启动一个监控协程，取消信号到达时立即 cancel 所有未完成的任务
    async def _cancel_watcher():
        # asyncio.Event.wait 是非阻塞协程，无需线程池
        await cancel_event.wait()
        for t in tasks:
            if not t.done():
                t.cancel()

    watcher = asyncio.create_task(_cancel_watcher())
    await asyncio.gather(*tasks, return_exceptions=True)
    watcher.cancel()

    # 发送完成/取消事件
    if cancel_event.is_set():
        await manager.broadcast(
            {
                "event": "batch_llm_complete",
                "project_id": project_id,
                "total": total,
                "cancelled": True,
                "log": f"⏹️ 批量LLM解析已取消！已完成 {done_counter['done']}/{total} 个章节",
            }
        )
    else:
        await manager.broadcast(
            {
                "event": "batch_llm_complete",
                "project_id": project_id,
                "total": total,
                "cancelled": False,
                "log": f"🎉 批量LLM解析全部完成！共处理 {total} 个章节",
            }
        )


# ============================================================
# 批量 TTS 配音（按章节一键配音）
# ============================================================


@router.post(
    "/tts-generate",
    response_model=Res,
    summary="批量TTS配音",
    description="选择章节范围，批量进行TTS配音，通过WebSocket推送日志和进度",
)
async def batch_tts_generate(req: BatchTTSRequest):
    """批量配音多个章节，通过 WS 推送实时进度"""
    from starlette.requests import Request

    # 获取 app 实例以访问 tts_queue
    # 这里直接启动异步任务
    task = asyncio.create_task(
        _do_batch_tts(req.project_id, req.chapter_ids, req.speed)
    )
    return Res(
        code=200,
        message="批量TTS配音任务已启动",
        data={"chapter_count": len(req.chapter_ids)},
    )


async def _do_batch_tts(project_id: int, chapter_ids: List[int], speed: float = 1.0):
    """后台执行批量TTS配音"""
    total_chapters = len(chapter_ids)
    total_lines = 0
    done_lines = 0

    # 先统计总台词数
    db = SessionLocal()
    try:
        services = _get_services(db)
        for cid in chapter_ids:
            lines = services["line"].get_all_lines(cid)
            total_lines += len([l for l in lines if l.role_id is not None])
    finally:
        db.close()

    await manager.broadcast(
        {
            "event": "batch_tts_start",
            "project_id": project_id,
            "total_chapters": total_chapters,
            "total_lines": total_lines,
            "log": f"🎙️ 开始批量配音：共 {total_chapters} 章, {total_lines} 条台词",
        }
    )

    for ch_idx, chapter_id in enumerate(chapter_ids):
        db = SessionLocal()
        try:
            services = _get_services(db)
            line_svc = services["line"]
            role_svc = services["role"]
            voice_svc = services["voice"]
            emotion_svc = services["emotion"]
            strength_svc = services["strength"]
            project_svc = services["project"]
            multi_emotion_svc = services["multi_emotion"]

            project = project_svc.get_project(project_id)
            lines = line_svc.get_all_lines(chapter_id)

            # 过滤有角色绑定的台词
            valid_lines = [l for l in lines if l.role_id is not None]

            await manager.broadcast(
                {
                    "event": "batch_tts_chapter_start",
                    "project_id": project_id,
                    "chapter_id": chapter_id,
                    "chapter_index": ch_idx + 1,
                    "total_chapters": total_chapters,
                    "line_count": len(valid_lines),
                    "log": f"📖 章节 {chapter_id} 开始配音 ({ch_idx + 1}/{total_chapters})，共 {len(valid_lines)} 条台词",
                }
            )

            for line_idx, line in enumerate(valid_lines):
                try:
                    role = role_svc.get_role(line.role_id)
                    if not role or not role.default_voice_id:
                        await manager.broadcast(
                            {
                                "event": "batch_tts_log",
                                "project_id": project_id,
                                "chapter_id": chapter_id,
                                "line_id": line.id,
                                "log": f"⚠️ 台词 {line.id} 角色未绑定音色，跳过",
                            }
                        )
                        done_lines += 1
                        continue

                    voice = voice_svc.get_voice(role.default_voice_id)
                    reference_path = voice.reference_path

                    # 获取情绪向量
                    emotion = (
                        emotion_svc.get_emotion(line.emotion_id)
                        if line.emotion_id
                        else None
                    )
                    strength = (
                        strength_svc.get_strength(line.strength_id)
                        if line.strength_id
                        else None
                    )
                    emo_vector = emotion_text_to_vector(
                        emotion.name if emotion else "平静",
                        strength.name if strength else "中等",
                    )

                    await manager.broadcast(
                        {
                            "event": "batch_tts_line_progress",
                            "project_id": project_id,
                            "chapter_id": chapter_id,
                            "line_id": line.id,
                            "line_index": line_idx + 1,
                            "line_total": len(valid_lines),
                            "overall_done": done_lines,
                            "overall_total": total_lines,
                            "progress": round((done_lines / max(total_lines, 1)) * 100),
                            "status": "processing",
                            "log": f"🔊 生成台词 {line.id}: {line.text_content[:30]}...",
                        }
                    )

                    # 执行 TTS
                    loop = asyncio.get_running_loop()
                    await loop.run_in_executor(
                        None,
                        line_svc.generate_audio,
                        reference_path,
                        project.tts_provider_id,
                        line.text_content,
                        None,  # emo_text
                        emo_vector,
                        line.audio_path,
                    )

                    # 速度调节
                    if (
                        speed != 1.0
                        and line.audio_path
                        and os.path.exists(line.audio_path)
                    ):
                        line_svc.process_audio_ffmpeg(line.audio_path, speed=speed)

                    line_svc.update_line(line.id, {"status": "done"})
                    done_lines += 1

                    await manager.broadcast(
                        {
                            "event": "batch_tts_line_progress",
                            "project_id": project_id,
                            "chapter_id": chapter_id,
                            "line_id": line.id,
                            "line_index": line_idx + 1,
                            "line_total": len(valid_lines),
                            "overall_done": done_lines,
                            "overall_total": total_lines,
                            "progress": round((done_lines / max(total_lines, 1)) * 100),
                            "status": "done",
                            "log": f"✅ 台词 {line.id} 配音完成",
                        }
                    )

                except Exception as e:
                    done_lines += 1
                    logger.error(f"TTS生成失败: {e}")
                    try:
                        line_svc.update_line(line.id, {"status": "failed"})
                    except Exception:
                        pass
                    await manager.broadcast(
                        {
                            "event": "batch_tts_line_progress",
                            "project_id": project_id,
                            "chapter_id": chapter_id,
                            "line_id": line.id,
                            "overall_done": done_lines,
                            "overall_total": total_lines,
                            "progress": round((done_lines / max(total_lines, 1)) * 100),
                            "status": "failed",
                            "log": f"❌ 台词 {line.id} 配音失败: {e}",
                        }
                    )

            await manager.broadcast(
                {
                    "event": "batch_tts_chapter_done",
                    "project_id": project_id,
                    "chapter_id": chapter_id,
                    "chapter_index": ch_idx + 1,
                    "total_chapters": total_chapters,
                    "log": f"✅ 章节 {chapter_id} 配音完成",
                }
            )

        except Exception as e:
            logger.error(f"批量TTS处理异常: {e}\n{traceback.format_exc()}")
            await manager.broadcast(
                {
                    "event": "batch_tts_log",
                    "project_id": project_id,
                    "chapter_id": chapter_id,
                    "log": f"❌ 章节 {chapter_id} 配音异常: {e}",
                }
            )
        finally:
            db.close()

    # 全部完成
    await manager.broadcast(
        {
            "event": "batch_tts_complete",
            "project_id": project_id,
            "total_chapters": total_chapters,
            "total_lines": total_lines,
            "log": f"🎉 批量配音全部完成！共处理 {total_chapters} 章, {done_lines} 条台词",
        }
    )


# ============================================================
# 语音调试 / 预览
# ============================================================


@router.post(
    "/voice-preview",
    response_model=Res,
    summary="语音预览",
    description="生成语音预览，支持速度调节",
)
async def voice_preview(req: VoicePreviewRequest, db: Session = Depends(get_db)):
    """单独的语音预览/调试接口"""
    try:
        services = _get_services(db)
        voice = services["voice"].get_voice(req.voice_id)
        if not voice:
            return Res(code=404, message="音色不存在")

        # 生成临时音频
        preview_dir = os.path.join(get_data_dir(), "previews")
        os.makedirs(preview_dir, exist_ok=True)

        import hashlib

        text_hash = hashlib.md5(
            f"{req.text}{req.voice_id}{req.emotion_name}{req.speed}".encode()
        ).hexdigest()[:12]
        preview_path = os.path.join(preview_dir, f"preview_{text_hash}.wav")

        emo_vector = emotion_text_to_vector(req.emotion_name, req.strength_name)

        line_svc = services["line"]
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(
            None,
            lambda: line_svc.generate_audio(
                voice.reference_path,
                req.tts_provider_id,
                req.text,
                None,
                emo_vector,
                preview_path,
                language=req.language,
            ),
        )

        # 速度调节
        if req.speed != 1.0 and os.path.exists(preview_path):
            line_svc.process_audio_ffmpeg(preview_path, speed=req.speed)

        # 返回可访问的音频路径
        relative_path = os.path.relpath(preview_path, get_data_dir())
        audio_url = f"/static/audio/{relative_path}"

        return Res(
            code=200,
            message="预览生成成功",
            data={
                "audio_url": audio_url,
                "audio_path": preview_path,
            },
        )

    except Exception as e:
        logger.error(f"语音预览失败: {e}\n{traceback.format_exc()}")
        return Res(code=500, message=f"语音预览失败: {e}")


@router.post(
    "/voice-debug",
    response_model=Res,
    summary="语音调试",
    description="独立的语音调试接口，不关联业务",
)
async def voice_debug(req: VoiceDebugRequest, db: Session = Depends(get_db)):
    """独立的语音调试页面使用的接口"""
    try:
        services = _get_services(db)
        voice = services["voice"].get_voice(req.voice_id)
        if not voice:
            return Res(code=404, message="音色不存在")

        # 生成调试音频
        debug_dir = os.path.join(get_data_dir(), "debug")
        os.makedirs(debug_dir, exist_ok=True)

        import time

        debug_path = os.path.join(debug_dir, f"debug_{int(time.time() * 1000)}.wav")

        emo_vector = emotion_text_to_vector(req.emotion_name, req.strength_name)

        line_svc = services["line"]
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(
            None,
            lambda: line_svc.generate_audio(
                voice.reference_path,
                req.tts_provider_id,
                req.text,
                None,
                emo_vector,
                debug_path,
                language=req.language,
            ),
        )

        # 速度调节
        if req.speed != 1.0 and os.path.exists(debug_path):
            line_svc.process_audio_ffmpeg(debug_path, speed=req.speed)

        relative_path = os.path.relpath(debug_path, get_data_dir())
        audio_url = f"/static/audio/{relative_path}"

        return Res(
            code=200,
            message="调试音频生成成功",
            data={
                "audio_url": audio_url,
                "audio_path": debug_path,
                "text": req.text,
                "voice_name": voice.name,
                "emotion": req.emotion_name,
                "strength": req.strength_name,
                "speed": req.speed,
            },
        )

    except Exception as e:
        logger.error(f"语音调试失败: {e}\n{traceback.format_exc()}")
        return Res(code=500, message=f"语音调试失败: {e}")


# ============================================================
# 语音速度调节
# ============================================================


class SpeedAdjustRequest(BaseModel):
    """速度调节请求"""

    line_id: int
    speed: float  # 0.5 ~ 2.0


class BatchSpeedAdjustRequest(BaseModel):
    """批量速度调节请求"""

    chapter_id: int
    speed: float  # 0.5 ~ 2.0


@router.post("/adjust-speed", response_model=Res, summary="单条台词速度调节")
async def adjust_speed(req: SpeedAdjustRequest, db: Session = Depends(get_db)):
    """调整单条台词的语速"""
    try:
        services = _get_services(db)
        line = services["line"].get_line(req.line_id)
        if not line or not line.audio_path or not os.path.exists(line.audio_path):
            return Res(code=404, message="台词音频不存在")

        services["line"].process_audio_ffmpeg(line.audio_path, speed=req.speed)

        relative_path = os.path.relpath(line.audio_path, get_data_dir())
        audio_url = f"/static/audio/{relative_path}"

        return Res(code=200, message="速度调节完成", data={"audio_url": audio_url})
    except Exception as e:
        return Res(code=500, message=f"速度调节失败: {e}")


@router.post(
    "/batch-adjust-speed",
    response_model=Res,
    summary="批量速度调节",
    description="调整整个章节所有台词的语速",
)
async def batch_adjust_speed(
    req: BatchSpeedAdjustRequest, db: Session = Depends(get_db)
):
    """批量调整章节内所有台词的语速"""
    try:
        services = _get_services(db)
        lines = services["line"].get_all_lines(req.chapter_id)
        adjusted = 0
        for line in lines:
            if line.audio_path and os.path.exists(line.audio_path):
                services["line"].process_audio_ffmpeg(line.audio_path, speed=req.speed)
                adjusted += 1

        return Res(
            code=200,
            message=f"批量速度调节完成，调整了 {adjusted} 条台词",
            data={"adjusted": adjusted},
        )
    except Exception as e:
        return Res(code=500, message=f"批量速度调节失败: {e}")


# ============================================================
# 一键挂机（Autopilot）：LLM → 智能音色 → TTS 全自动流水线
# ============================================================


class AutopilotRequest(BaseModel):
    """一键挂机请求"""

    project_id: int
    chapter_ids: List[int]
    concurrency: int = 1  # LLM 并发数
    speed: float = 1.0  # TTS 全局速度
    voice_match_interval: int = 10  # 每隔多少章做一次智能音色匹配
    manual_voice_assign: bool = (
        False  # 是否手动分配音色（跳过智能匹配，直接暂停让用户分配）
    )


# 存储运行中的挂机任务: project_id -> task_info
_autopilot_tasks: dict = {}


@router.post(
    "/autopilot-start",
    response_model=Res,
    summary="一键挂机启动",
    description="自动执行 LLM解析 → 智能音色匹配 → TTS配音 的全流程，支持暂停/继续",
)
async def autopilot_start(req: AutopilotRequest):
    """启动一键挂机任务"""
    if req.project_id in _autopilot_tasks:
        return Res(code=400, message="该项目已有挂机任务在运行中，请先取消后再重试")

    concurrency = max(1, min(10, req.concurrency))
    cancel_event = asyncio.Event()
    pause_event = asyncio.Event()  # set = 暂停中
    resume_event = asyncio.Event()  # set = 可以继续
    resume_event.set()  # 默认不暂停

    task = asyncio.create_task(
        _do_autopilot(
            req.project_id,
            req.chapter_ids,
            concurrency,
            req.speed,
            req.voice_match_interval,
            req.manual_voice_assign,
            cancel_event,
            pause_event,
            resume_event,
        )
    )

    _autopilot_tasks[req.project_id] = {
        "cancel_event": cancel_event,
        "pause_event": pause_event,
        "resume_event": resume_event,
        "task": task,
        "chapter_ids": req.chapter_ids,
    }

    def _cleanup(fut):
        _autopilot_tasks.pop(req.project_id, None)

    task.add_done_callback(_cleanup)

    return Res(
        code=200,
        message="一键挂机任务已启动",
        data={
            "chapter_count": len(req.chapter_ids),
            "concurrency": concurrency,
            "voice_match_interval": req.voice_match_interval,
        },
    )


@router.get(
    "/autopilot-status",
    response_model=Res,
    summary="查询挂机任务状态",
)
async def autopilot_status(project_id: int):
    """查询一键挂机任务是否正在运行"""
    task_info = _autopilot_tasks.get(project_id)
    if not task_info:
        return Res(code=200, message="无运行中的任务", data={"running": False})

    return Res(
        code=200,
        message="任务运行中",
        data={
            "running": True,
            "paused": task_info["pause_event"].is_set(),
            "cancelled": task_info["cancel_event"].is_set(),
        },
    )


@router.post(
    "/autopilot-pause",
    response_model=Res,
    summary="暂停挂机任务",
    description="暂停一键挂机任务，当前章节会处理完再暂停",
)
async def autopilot_pause(project_id: int):
    """暂停一键挂机任务"""
    task_info = _autopilot_tasks.get(project_id)
    if not task_info:
        return Res(code=404, message="没有正在运行的挂机任务")

    task_info["pause_event"].set()
    task_info["resume_event"].clear()
    logger.info(f"挂机任务暂停信号已发送: project_id={project_id}")

    await manager.broadcast(
        {
            "event": "autopilot_log",
            "project_id": project_id,
            "log": "⏸️ 暂停信号已发送，当前章节处理完后暂停",
        }
    )
    return Res(code=200, message="暂停信号已发送，当前章节处理完后暂停")


@router.post(
    "/autopilot-resume",
    response_model=Res,
    summary="继续挂机任务",
    description="继续已暂停的一键挂机任务",
)
async def autopilot_resume(project_id: int):
    """继续已暂停的一键挂机任务"""
    task_info = _autopilot_tasks.get(project_id)
    if not task_info:
        return Res(code=404, message="没有正在运行的挂机任务")

    task_info["pause_event"].clear()
    task_info["resume_event"].set()
    logger.info(f"挂机任务继续信号已发送: project_id={project_id}")

    await manager.broadcast(
        {
            "event": "autopilot_log",
            "project_id": project_id,
            "log": "▶️ 任务已继续",
        }
    )
    return Res(code=200, message="任务已继续")


@router.post(
    "/autopilot-cancel",
    response_model=Res,
    summary="取消挂机任务",
)
async def autopilot_cancel(project_id: int):
    """取消一键挂机任务"""
    task_info = _autopilot_tasks.get(project_id)
    if not task_info:
        return Res(code=404, message="没有正在运行的挂机任务")

    task_info["cancel_event"].set()
    # 如果暂停中，也要唤醒让它退出
    task_info["resume_event"].set()
    logger.info(f"挂机任务取消信号已发送: project_id={project_id}")
    return Res(code=200, message="取消信号已发送")


# ---- 一键挂机核心逻辑 ----


async def _autopilot_wait_resume(
    project_id: int,
    pause_event: asyncio.Event,
    resume_event: asyncio.Event,
    cancel_event: asyncio.Event,
) -> bool:
    """
    检查是否暂停，如果暂停则等待恢复。
    返回 True 表示可以继续，False 表示已取消。
    """
    if cancel_event.is_set():
        return False

    if pause_event.is_set():
        await manager.broadcast(
            {
                "event": "autopilot_paused",
                "project_id": project_id,
                "log": "⏸️ 任务已暂停，等待用户继续...",
            }
        )
        # asyncio.Event.wait 是非阻塞协程，无需线程池
        await resume_event.wait()
        if cancel_event.is_set():
            return False
        await manager.broadcast(
            {
                "event": "autopilot_resumed",
                "project_id": project_id,
                "log": "▶️ 任务已恢复",
            }
        )
    return True


async def _autopilot_llm_single_chapter(
    project_id: int,
    chapter_id: int,
    cancel_event: asyncio.Event,
) -> bool:
    """
    对单个章节执行 LLM 解析（纯协程，复用 _process_single_chapter_async）。
    返回 True=成功, False=失败或取消。
    """
    done_counter = {"done": 0}

    # 临时替换 manager.broadcast 来捕获事件并改写前缀
    original_broadcast = manager.broadcast
    success = False

    async def _intercepted_broadcast(msg: dict):
        nonlocal success
        original_event = msg.get("event", "")
        if original_event == "batch_llm_progress":
            msg["event"] = "autopilot_llm_progress"
            if msg.get("status") == "done":
                success = True
        elif original_event == "batch_llm_log":
            msg["event"] = "autopilot_llm_log"
        await original_broadcast(msg)

    manager.broadcast = _intercepted_broadcast
    try:
        await _process_single_chapter_async(
            project_id,
            chapter_id,
            0,  # idx
            1,  # total
            cancel_event,
            done_counter,
        )
    finally:
        manager.broadcast = original_broadcast

    return success


async def _autopilot_tts_single_chapter(
    project_id: int,
    chapter_id: int,
    speed: float,
    cancel_event: asyncio.Event,
) -> bool:
    """
    对单个章节执行 TTS 配音。
    返回 True=成功（所有台词配音完成）, False=有失败。
    """
    db = SessionLocal()
    has_failure = False
    try:
        services = _get_services(db)
        line_svc = services["line"]
        role_svc = services["role"]
        voice_svc = services["voice"]
        emotion_svc = services["emotion"]
        strength_svc = services["strength"]
        project_svc = services["project"]

        project = project_svc.get_project(project_id)
        lines = line_svc.get_all_lines(chapter_id)
        valid_lines = [l for l in lines if l.role_id is not None]

        await manager.broadcast(
            {
                "event": "autopilot_tts_chapter_start",
                "project_id": project_id,
                "chapter_id": chapter_id,
                "line_count": len(valid_lines),
                "log": f"🎙️ 章节 {chapter_id} 开始配音，共 {len(valid_lines)} 条台词",
            }
        )

        done_count = 0
        for line_idx, line in enumerate(valid_lines):
            if cancel_event.is_set():
                return False

            try:
                role = role_svc.get_role(line.role_id)
                if not role or not role.default_voice_id:
                    await manager.broadcast(
                        {
                            "event": "autopilot_tts_log",
                            "project_id": project_id,
                            "chapter_id": chapter_id,
                            "log": f"⚠️ 台词 {line.id} 角色未绑定音色，跳过",
                        }
                    )
                    done_count += 1
                    continue

                voice = voice_svc.get_voice(role.default_voice_id)
                reference_path = voice.reference_path

                emotion = (
                    emotion_svc.get_emotion(line.emotion_id)
                    if line.emotion_id
                    else None
                )
                strength = (
                    strength_svc.get_strength(line.strength_id)
                    if line.strength_id
                    else None
                )
                emo_vector = emotion_text_to_vector(
                    emotion.name if emotion else "平静",
                    strength.name if strength else "中等",
                )

                await manager.broadcast(
                    {
                        "event": "autopilot_tts_line",
                        "project_id": project_id,
                        "chapter_id": chapter_id,
                        "line_index": line_idx + 1,
                        "line_total": len(valid_lines),
                        "log": f"🔊 [{line_idx+1}/{len(valid_lines)}] {line.text_content[:30]}...",
                    }
                )

                loop = asyncio.get_running_loop()
                await loop.run_in_executor(
                    None,
                    line_svc.generate_audio,
                    reference_path,
                    project.tts_provider_id,
                    line.text_content,
                    None,
                    emo_vector,
                    line.audio_path,
                )

                if speed != 1.0 and line.audio_path and os.path.exists(line.audio_path):
                    line_svc.process_audio_ffmpeg(line.audio_path, speed=speed)

                line_svc.update_line(line.id, {"status": "done"})
                done_count += 1

            except Exception as e:
                done_count += 1
                has_failure = True
                logger.error(f"TTS生成失败: {e}")
                try:
                    line_svc.update_line(line.id, {"status": "failed"})
                except Exception:
                    pass
                await manager.broadcast(
                    {
                        "event": "autopilot_tts_log",
                        "project_id": project_id,
                        "chapter_id": chapter_id,
                        "log": f"❌ 台词 {line.id} 配音失败: {e}",
                    }
                )

        await manager.broadcast(
            {
                "event": "autopilot_tts_chapter_done",
                "project_id": project_id,
                "chapter_id": chapter_id,
                "log": f"✅ 章节 {chapter_id} 配音完成 ({done_count}/{len(valid_lines)})",
            }
        )
        return not has_failure

    except Exception as e:
        logger.error(f"挂机TTS异常: {e}\n{traceback.format_exc()}")
        await manager.broadcast(
            {
                "event": "autopilot_tts_log",
                "project_id": project_id,
                "chapter_id": chapter_id,
                "log": f"❌ 章节 {chapter_id} 配音异常: {e}",
            }
        )
        return False
    finally:
        db.close()


async def _autopilot_smart_voice_match(project_id: int) -> dict:
    """
    对项目执行智能音色匹配（为未绑定音色的角色自动分配）。
    返回 {"success": bool, "unmatched_roles": [...], "matched": [...]}
    """
    db = SessionLocal()
    try:
        services = _get_services(db)
        role_svc = services["role"]
        voice_svc = services["voice"]
        project_svc = services["project"]
        chapter_svc = services["chapter"]

        project = project_svc.get_project(project_id)
        roles = role_svc.get_all_roles(project_id)

        # 未绑定音色的角色
        unbound_roles = [r for r in roles if r.default_voice_id is None]
        if not unbound_roles:
            return {"success": True, "unmatched_roles": [], "matched": []}

        unbound_names = [r.name for r in unbound_roles]

        # 获取所有音色
        voices = voice_svc.get_all_voices(project.tts_provider_id)
        voice_names = [{"name": v.name, "description": v.description} for v in voices]
        voice_id_map = {v.name: v.id for v in voices}

        # 使用项目的 LLM 进行智能匹配
        from py.core.prompts import get_add_smart_role_and_voice
        from py.core.llm_engine import LLMEngine
        from py.repositories.llm_provider_repository import LLMProviderRepository

        llm_repo = LLMProviderRepository(db)
        llm_provider = llm_repo.get_by_id(project.llm_provider_id)
        llm = LLMEngine(
            llm_provider.api_key,
            llm_provider.api_base_url,
            project.llm_model,
            llm_provider.custom_params,
        )

        # 获取项目下所有章节的首章文本作为上下文（简化处理）
        all_chapters = chapter_svc.get_all_chapters(project_id)
        # 拿第一个有内容的章节作为上下文
        context_text = ""
        for ch_info in all_chapters[:5]:  # 最多看前5章
            ch = chapter_svc.get_chapter(ch_info["id"])
            if ch and ch.text_content:
                context_text += ch.text_content[:500] + "\n"
            if len(context_text) > 2000:
                break

        prompt = get_add_smart_role_and_voice(context_text, unbound_names, voice_names)
        result = await llm.generate_smart_text_async(prompt)
        parse_data = await llm.save_load_json_async(result)

        matched = []
        still_unmatched = list(unbound_names)

        from py.repositories.role_repository import RoleRepository

        role_repo = RoleRepository(db)

        if parse_data:
            for item in parse_data:
                role_name = item.get("role_name", "")
                voice_name = item.get("voice_name", "")
                if role_name and voice_name and voice_name in voice_id_map:
                    role = role_repo.get_by_name(role_name, project_id)
                    if role:
                        role_repo.update(
                            role.id,
                            {"default_voice_id": voice_id_map[voice_name]},
                        )
                        matched.append(
                            {"role_name": role_name, "voice_name": voice_name}
                        )
                        if role_name in still_unmatched:
                            still_unmatched.remove(role_name)

        return {
            "success": len(still_unmatched) == 0,
            "unmatched_roles": still_unmatched,
            "matched": matched,
        }

    except Exception as e:
        logger.error(f"智能音色匹配失败: {e}\n{traceback.format_exc()}")
        return {"success": False, "unmatched_roles": [], "matched": [], "error": str(e)}
    finally:
        db.close()


def _check_chapter_unbound_roles(project_id: int, chapter_id: int) -> list:
    """
    检查某章节的台词中，是否有角色未绑定音色。
    返回未绑定的角色名称列表。
    """
    db = SessionLocal()
    try:
        services = _get_services(db)
        line_svc = services["line"]
        role_svc = services["role"]

        lines = line_svc.get_all_lines(chapter_id)
        unbound_role_names = []
        seen_role_ids = set()

        for line in lines:
            if line.role_id and line.role_id not in seen_role_ids:
                seen_role_ids.add(line.role_id)
                role = role_svc.get_role(line.role_id)
                if role and not role.default_voice_id:
                    unbound_role_names.append(role.name)

        return unbound_role_names
    finally:
        db.close()


async def _do_autopilot(
    project_id: int,
    chapter_ids: List[int],
    concurrency: int,
    speed: float,
    voice_match_interval: int,
    manual_voice_assign: bool,
    cancel_event: asyncio.Event,
    pause_event: asyncio.Event,
    resume_event: asyncio.Event,
):
    """
    一键挂机核心流程（并行流水线模式）：
    - LLM Producer：并发执行 LLM 解析，完成后将章节放入 tts_queue
    - TTS Consumer：从 tts_queue 取章节，检查音色后执行 TTS
    - 两者通过 asyncio.Queue 协作，同时运行
    - 每 voice_match_interval 章做一次智能音色匹配
    - 支持暂停/继续/取消
    """
    total = len(chapter_ids)
    llm_done_count = 0
    tts_done_count = 0
    # 追踪自上次智能匹配后已处理的章节数
    chapters_since_last_match = 0
    # LLM 完成后放入此队列，TTS Consumer 从中取
    # 队列元素: (chapter_id, ch_idx, llm_success)
    tts_queue: asyncio.Queue = asyncio.Queue()
    # 用于音色匹配的锁（防止多个 LLM worker 同时触发匹配）
    voice_match_lock = asyncio.Lock()

    await manager.broadcast(
        {
            "event": "autopilot_start",
            "project_id": project_id,
            "total": total,
            "log": f"🚀 一键挂机已启动（并行流水线）：共 {total} 章，LLM并发数 {concurrency}，每 {voice_match_interval} 章匹配音色",
        }
    )

    # ---- LLM Producer：并发执行 LLM 解析 ----
    semaphore = asyncio.Semaphore(concurrency)

    async def _llm_worker(chapter_id: int, ch_idx: int):
        """单个 LLM 任务：解析完成后放入 TTS 队列"""
        nonlocal llm_done_count, chapters_since_last_match

        # 检查暂停/取消
        can_continue = await _autopilot_wait_resume(
            project_id, pause_event, resume_event, cancel_event
        )
        if not can_continue:
            return

        async with semaphore:
            if cancel_event.is_set():
                return

            await manager.broadcast(
                {
                    "event": "autopilot_progress",
                    "project_id": project_id,
                    "phase": "llm",
                    "chapter_id": chapter_id,
                    "llm_done": llm_done_count,
                    "tts_done": tts_done_count,
                    "total": total,
                    "log": f"📖 [{ch_idx+1}/{total}] 章节 {chapter_id} 开始 LLM 解析",
                }
            )

            llm_success = await _autopilot_llm_single_chapter(
                project_id, chapter_id, cancel_event
            )

            if cancel_event.is_set():
                return

            if llm_success:
                llm_done_count += 1
                chapters_since_last_match += 1

                await manager.broadcast(
                    {
                        "event": "autopilot_progress",
                        "project_id": project_id,
                        "phase": "llm_done",
                        "chapter_id": chapter_id,
                        "llm_done": llm_done_count,
                        "tts_done": tts_done_count,
                        "total": total,
                        "log": f"✅ [{llm_done_count}/{total}] 章节 {chapter_id} LLM 解析完成",
                    }
                )

                # LLM 完成后检查是否需要音色匹配（加锁防止并发冲突）
                async with voice_match_lock:
                    await _autopilot_check_voice_match(
                        project_id,
                        chapter_id,
                        chapters_since_last_match,
                        voice_match_interval,
                        manual_voice_assign,
                        pause_event,
                        resume_event,
                        cancel_event,
                    )
                    if chapters_since_last_match >= voice_match_interval:
                        chapters_since_last_match = 0

                # 放入 TTS 队列
                await tts_queue.put((chapter_id, ch_idx, True))
            else:
                llm_done_count += 1  # 失败也计入进度
                await manager.broadcast(
                    {
                        "event": "autopilot_progress",
                        "project_id": project_id,
                        "phase": "llm_error",
                        "chapter_id": chapter_id,
                        "llm_done": llm_done_count,
                        "tts_done": tts_done_count,
                        "total": total,
                        "log": f"❌ 章节 {chapter_id} LLM 解析失败，跳过该章TTS",
                    }
                )
                # 失败也放入队列，标记为失败
                await tts_queue.put((chapter_id, ch_idx, False))

            await asyncio.sleep(0.1)

    async def _llm_producer():
        """LLM 生产者：逐章发起 LLM 任务（信号量控制并发）"""
        tasks = []
        for ch_idx, chapter_id in enumerate(chapter_ids):
            if cancel_event.is_set():
                break
            task = asyncio.create_task(_llm_worker(chapter_id, ch_idx))
            tasks.append(task)

        # 等待所有 LLM 任务完成
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

        # 发送结束哨兵，告知 TTS Consumer 所有 LLM 都完成了
        await tts_queue.put(None)

    # ---- TTS Consumer：从队列取章节执行 TTS ----
    async def _tts_consumer():
        """TTS 消费者：串行从队列取章节执行 TTS 配音"""
        nonlocal tts_done_count

        while True:
            if cancel_event.is_set():
                break

            # 从队列获取下一个要配音的章节
            item = await tts_queue.get()

            # 收到结束哨兵，退出
            if item is None:
                break

            chapter_id, ch_idx, llm_success = item

            if cancel_event.is_set():
                break

            # LLM 失败的章节跳过 TTS
            if not llm_success:
                tts_done_count += 1
                await manager.broadcast(
                    {
                        "event": "autopilot_progress",
                        "project_id": project_id,
                        "phase": "tts_error",
                        "chapter_id": chapter_id,
                        "llm_done": llm_done_count,
                        "tts_done": tts_done_count,
                        "total": total,
                        "log": f"⏭️ 章节 {chapter_id} LLM失败，跳过配音",
                    }
                )
                continue

            # 检查暂停/取消
            can_continue = await _autopilot_wait_resume(
                project_id, pause_event, resume_event, cancel_event
            )
            if not can_continue:
                break

            # 检查该章节角色是否都已绑定音色
            unbound_now = _check_chapter_unbound_roles(project_id, chapter_id)
            if unbound_now:
                await manager.broadcast(
                    {
                        "event": "autopilot_log",
                        "project_id": project_id,
                        "chapter_id": chapter_id,
                        "log": f"⚠️ 章节 {chapter_id} 有 {len(unbound_now)} 个角色未绑定音色，跳过配音: {', '.join(unbound_now)}",
                    }
                )
                tts_done_count += 1
                await manager.broadcast(
                    {
                        "event": "autopilot_progress",
                        "project_id": project_id,
                        "phase": "tts_error",
                        "chapter_id": chapter_id,
                        "llm_done": llm_done_count,
                        "tts_done": tts_done_count,
                        "total": total,
                        "log": f"⏭️ 章节 {chapter_id} 角色未绑定音色，已跳过",
                    }
                )
                continue

            # 执行 TTS 配音
            await manager.broadcast(
                {
                    "event": "autopilot_progress",
                    "project_id": project_id,
                    "phase": "tts",
                    "chapter_id": chapter_id,
                    "llm_done": llm_done_count,
                    "tts_done": tts_done_count,
                    "total": total,
                    "log": f"🎙️ 章节 {chapter_id} 开始 TTS 配音",
                }
            )

            tts_success = await _autopilot_tts_single_chapter(
                project_id, chapter_id, speed, cancel_event
            )
            tts_done_count += 1

            await manager.broadcast(
                {
                    "event": "autopilot_progress",
                    "project_id": project_id,
                    "phase": "tts_done" if tts_success else "tts_error",
                    "chapter_id": chapter_id,
                    "llm_done": llm_done_count,
                    "tts_done": tts_done_count,
                    "total": total,
                    "log": f"{'✅' if tts_success else '⚠️'} 章节 {chapter_id} 配音{'完成' if tts_success else '有失败项'}",
                }
            )

    # ---- 并行运行 LLM Producer 和 TTS Consumer ----
    await asyncio.gather(_llm_producer(), _tts_consumer())

    # ---- 完成 ----
    if cancel_event.is_set():
        await manager.broadcast(
            {
                "event": "autopilot_complete",
                "project_id": project_id,
                "cancelled": True,
                "llm_done": llm_done_count,
                "tts_done": tts_done_count,
                "total": total,
                "log": f"⏹️ 一键挂机已取消！LLM完成 {llm_done_count}/{total}，TTS完成 {tts_done_count}/{total}",
            }
        )
    else:
        await manager.broadcast(
            {
                "event": "autopilot_complete",
                "project_id": project_id,
                "cancelled": False,
                "llm_done": llm_done_count,
                "tts_done": tts_done_count,
                "total": total,
                "log": f"🎉 一键挂机全部完成！LLM完成 {llm_done_count}/{total}，TTS完成 {tts_done_count}/{total}",
            }
        )


async def _autopilot_check_voice_match(
    project_id: int,
    chapter_id: int,
    chapters_since_last_match: int,
    voice_match_interval: int,
    manual_voice_assign: bool,
    pause_event: asyncio.Event,
    resume_event: asyncio.Event,
    cancel_event: asyncio.Event,
):
    """
    检查是否需要进行音色匹配（从 _do_autopilot 中抽取出来的逻辑）。
    在 LLM 完成后、放入 TTS 队列前调用。
    """
    need_voice_match = chapters_since_last_match >= voice_match_interval

    if not (need_voice_match or manual_voice_assign):
        return

    # 检查是否有未绑定音色的角色
    unbound = _check_chapter_unbound_roles(project_id, chapter_id)

    if not unbound:
        return

    if manual_voice_assign:
        # 手动模式：直接暂停
        await manager.broadcast(
            {
                "event": "autopilot_voice_needed",
                "project_id": project_id,
                "chapter_id": chapter_id,
                "unbound_roles": unbound,
                "log": f"⏸️ 发现 {len(unbound)} 个角色未绑定音色: {', '.join(unbound)}，请手动分配后继续",
            }
        )
        pause_event.set()
        resume_event.clear()
        # 等待用户继续
        await _autopilot_wait_resume(
            project_id, pause_event, resume_event, cancel_event
        )
    else:
        # 自动智能匹配
        await manager.broadcast(
            {
                "event": "autopilot_log",
                "project_id": project_id,
                "log": f"🤖 检测到 {len(unbound)} 个新角色未绑定音色，开始智能匹配...",
            }
        )

        match_result = await _autopilot_smart_voice_match(project_id)

        if match_result["matched"]:
            matched_str = ", ".join(
                [f"{m['role_name']}→{m['voice_name']}" for m in match_result["matched"]]
            )
            await manager.broadcast(
                {
                    "event": "autopilot_voice_matched",
                    "project_id": project_id,
                    "matched": match_result["matched"],
                    "log": f"✅ 智能匹配成功: {matched_str}",
                }
            )

        if match_result["unmatched_roles"]:
            # 匹配失败，暂停让用户手动分配
            await manager.broadcast(
                {
                    "event": "autopilot_voice_needed",
                    "project_id": project_id,
                    "chapter_id": chapter_id,
                    "unbound_roles": match_result["unmatched_roles"],
                    "log": f"⚠️ 仍有 {len(match_result['unmatched_roles'])} 个角色未匹配到音色: {', '.join(match_result['unmatched_roles'])}，请手动分配后继续",
                }
            )
            pause_event.set()
            resume_event.clear()
            await _autopilot_wait_resume(
                project_id, pause_event, resume_event, cancel_event
            )
