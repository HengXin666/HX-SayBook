"""
批量处理路由 - 支持批量LLM解析和批量TTS配音
所有操作通过 WebSocket 推送实时日志和进度
"""

import asyncio
import json
import logging
import os
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


class VoiceDebugRequest(BaseModel):
    """语音调试请求"""

    text: str
    voice_id: int
    tts_provider_id: int
    emotion_name: str = "平静"
    strength_name: str = "中等"
    speed: float = 1.0


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
# 批量 LLM 解析
# ============================================================


@router.post(
    "/llm-parse",
    response_model=Res,
    summary="批量LLM解析章节",
    description="选择章节范围，批量进行LLM台词拆分，通过WebSocket推送日志和进度",
)
async def batch_llm_parse(req: BatchLLMRequest):
    """批量解析多个章节，通过 WS 推送实时进度"""
    task = asyncio.create_task(_do_batch_llm(req.project_id, req.chapter_ids))
    return Res(
        code=200,
        message="批量LLM解析任务已启动",
        data={"chapter_count": len(req.chapter_ids)},
    )


async def _do_batch_llm(project_id: int, chapter_ids: List[int]):
    """后台执行批量LLM解析"""
    total = len(chapter_ids)

    for idx, chapter_id in enumerate(chapter_ids):
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

            progress = round((idx / total) * 100)

            await manager.broadcast(
                {
                    "event": "batch_llm_progress",
                    "project_id": project_id,
                    "chapter_id": chapter_id,
                    "current": idx + 1,
                    "total": total,
                    "progress": progress,
                    "status": "processing",
                    "log": f"📖 开始解析章节 {chapter_id} ({idx + 1}/{total})",
                }
            )

            chapter = chapter_svc.get_chapter(chapter_id)
            if not chapter or not chapter.text_content:
                await manager.broadcast(
                    {
                        "event": "batch_llm_progress",
                        "project_id": project_id,
                        "chapter_id": chapter_id,
                        "current": idx + 1,
                        "total": total,
                        "progress": progress,
                        "status": "skipped",
                        "log": f"⚠️ 章节 {chapter_id} 内容为空，已跳过",
                    }
                )
                continue

            # 拆分文本
            try:
                contents = chapter_svc.split_text(chapter_id, 1500)
                await manager.broadcast(
                    {
                        "event": "batch_llm_log",
                        "project_id": project_id,
                        "chapter_id": chapter_id,
                        "log": f"📝 章节文本划分为 {len(contents)} 段",
                    }
                )
            except Exception as e:
                await manager.broadcast(
                    {
                        "event": "batch_llm_progress",
                        "project_id": project_id,
                        "chapter_id": chapter_id,
                        "current": idx + 1,
                        "total": total,
                        "progress": progress,
                        "status": "error",
                        "log": f"❌ 章节拆分失败: {e}",
                    }
                )
                continue

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
                await manager.broadcast(
                    {
                        "event": "batch_llm_progress",
                        "project_id": project_id,
                        "chapter_id": chapter_id,
                        "current": idx + 1,
                        "total": total,
                        "progress": progress,
                        "status": "error",
                        "log": "❌ 项目缺少 TTS/LLM/Model 配置",
                    }
                )
                continue

            prompt = (
                prompt_svc.get_prompt(project.prompt_id) if project.prompt_id else None
            )
            if not prompt:
                await manager.broadcast(
                    {
                        "event": "batch_llm_progress",
                        "project_id": project_id,
                        "chapter_id": chapter_id,
                        "current": idx + 1,
                        "total": total,
                        "progress": progress,
                        "status": "error",
                        "log": "❌ 提示词不存在",
                    }
                )
                continue

            # 逐段解析
            all_line_data = []
            parse_success = True
            for seg_idx, content in enumerate(contents):
                await manager.broadcast(
                    {
                        "event": "batch_llm_log",
                        "project_id": project_id,
                        "chapter_id": chapter_id,
                        "log": f"🔄 解析第 {seg_idx + 1}/{len(contents)} 段...",
                    }
                )

                try:
                    result = chapter_svc.para_content(
                        prompt.content,
                        chapter_id,
                        content,
                        list(roles_set),
                        emotion_names,
                        strength_names,
                        is_precise_fill,
                    )

                    if not result["success"]:
                        await manager.broadcast(
                            {
                                "event": "batch_llm_log",
                                "project_id": project_id,
                                "chapter_id": chapter_id,
                                "log": f"❌ 段 {seg_idx + 1} 解析失败: {result['message']}",
                            }
                        )
                        parse_success = False
                        break

                    lines_data = result["data"]
                    for ld in lines_data:
                        roles_set.add(ld.role_name)
                    all_line_data.extend(lines_data)

                    await manager.broadcast(
                        {
                            "event": "batch_llm_log",
                            "project_id": project_id,
                            "chapter_id": chapter_id,
                            "log": f"✅ 段 {seg_idx + 1} 解析完成，获得 {len(lines_data)} 条台词",
                        }
                    )

                except Exception as e:
                    logger.error(f"解析失败: {e}\n{traceback.format_exc()}")
                    await manager.broadcast(
                        {
                            "event": "batch_llm_log",
                            "project_id": project_id,
                            "chapter_id": chapter_id,
                            "log": f"❌ 段 {seg_idx + 1} 解析异常: {e}",
                        }
                    )
                    parse_success = False
                    break

            if parse_success and all_line_data:
                # 写入数据库
                try:
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

                    await manager.broadcast(
                        {
                            "event": "batch_llm_progress",
                            "project_id": project_id,
                            "chapter_id": chapter_id,
                            "current": idx + 1,
                            "total": total,
                            "progress": round(((idx + 1) / total) * 100),
                            "status": "done",
                            "log": f"✅ 章节 {chapter_id} 解析完成，共 {len(all_line_data)} 条台词",
                        }
                    )
                except Exception as e:
                    await manager.broadcast(
                        {
                            "event": "batch_llm_progress",
                            "project_id": project_id,
                            "chapter_id": chapter_id,
                            "current": idx + 1,
                            "total": total,
                            "progress": progress,
                            "status": "error",
                            "log": f"❌ 写入数据库失败: {e}",
                        }
                    )
            else:
                await manager.broadcast(
                    {
                        "event": "batch_llm_progress",
                        "project_id": project_id,
                        "chapter_id": chapter_id,
                        "current": idx + 1,
                        "total": total,
                        "progress": progress,
                        "status": "error",
                        "log": f"❌ 章节 {chapter_id} 解析失败",
                    }
                )

        except Exception as e:
            logger.error(f"批量LLM处理异常: {e}\n{traceback.format_exc()}")
            await manager.broadcast(
                {
                    "event": "batch_llm_progress",
                    "project_id": project_id,
                    "chapter_id": chapter_id,
                    "current": idx + 1,
                    "total": total,
                    "progress": 0,
                    "status": "error",
                    "log": f"❌ 未知错误: {e}",
                }
            )
        finally:
            db.close()

        # 避免过快请求LLM
        await asyncio.sleep(0.5)

    # 全部完成
    await manager.broadcast(
        {
            "event": "batch_llm_complete",
            "project_id": project_id,
            "total": total,
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
            line_svc.generate_audio,
            voice.reference_path,
            req.tts_provider_id,
            req.text,
            None,
            emo_vector,
            preview_path,
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
            line_svc.generate_audio,
            voice.reference_path,
            req.tts_provider_id,
            req.text,
            None,
            emo_vector,
            debug_path,
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
