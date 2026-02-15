# py/tts_worker.py
import asyncio
from fastapi import FastAPI

from py.core.ws_manager import manager
from py.db.database import SessionLocal
from py.routers.chapter_router import (
    get_voice_service,
    get_emotion_service,
    get_strength_service,
)
from py.routers.multi_emotion_voice_router import get_multi_emotion_voice_service
from py.routers.role_router import (
    get_line_service,
    get_role_service,
    get_project_service,
)

TTS_TIMEOUT_SECONDS = 1200  # 可调


def emotion_text_to_vector(emotion: str, intensity: str) -> list[float]:
    """
    将情绪(文本) + 强度(文本) 转换成 8维向量
    :param emotion: 基础情绪或复合情绪名称
    :param intensity: "微弱" / "稍弱" / "中等" / "较强" / "强烈"
    :return: 长度为8的向量

    Index-TTS 8 维向量定义 (来源: IndexTeam/IndexTTS-2 normalize_emo_vec):
      [高兴, 生气, 伤心, 害怕, 厌恶, 低落, 惊喜, 平静]
      idx: 0     1     2     3     4     5     6     7

    官方偏置因子 (emo_bias): [0.9375, 0.875, 1.0, 1.0, 0.9375, 0.9375, 0.6875, 0.5625]
    归一化约束: 总和 ≤ 0.8

    参考: https://github.com/index-tts/index-tts (infer_v2.py normalize_emo_vec)
    """

    # === 基础情绪 → 单维度映射 ===
    BASIC_EMOTIONS = ["高兴", "生气", "伤心", "害怕", "厌恶", "低落", "惊喜", "平静"]

    # === 复合情绪 → 多维度组合向量 (归一化前, 值为 0~1 的比例) ===
    # 设计原则:
    #   1. 基于心理学的 Plutchik 情绪轮, 复合情绪由 2~3 个基础情绪混合
    #   2. 向量总和控制在 0.8 以内 (Index-TTS 归一化约束)
    #   3. 主导情绪占比 ≥ 0.5, 辅助情绪占比 ≤ 0.3
    #   4. 每个向量经过 Index-TTS 官方 emo_bias 加权后仍在合理范围
    #
    # 格式: "情绪名" → [高兴, 生气, 伤心, 害怕, 厌恶, 低落, 惊喜, 平静]
    COMPOUND_EMOTIONS: dict[str, list[float]] = {
        # 疑惑: 惊讶为主 + 害怕(不确定感)
        "疑惑": [0.0, 0.0, 0.0, 0.25, 0.0, 0.0, 0.45, 0.0],
        # 紧张: 害怕为主 + 低落辅助
        "紧张": [0.0, 0.0, 0.0, 0.55, 0.0, 0.25, 0.0, 0.0],
        # 感动: 高兴为主 + 伤心(喜极而泣)
        "感动": [0.5, 0.0, 0.3, 0.0, 0.0, 0.0, 0.0, 0.0],
        # 无奈: 低落为主 + 轻微厌恶
        "无奈": [0.0, 0.0, 0.0, 0.0, 0.2, 0.55, 0.0, 0.0],
        # 得意: 高兴为主 + 惊喜
        "得意": [0.55, 0.0, 0.0, 0.0, 0.0, 0.0, 0.25, 0.0],
        # 嘲讽: 厌恶为主 + 高兴
        "嘲讽": [0.25, 0.0, 0.0, 0.0, 0.55, 0.0, 0.0, 0.0],
        # 焦虑: 害怕为主 + 低落辅助 + 轻微生气(烦躁)
        "焦虑": [0.0, 0.15, 0.0, 0.45, 0.0, 0.2, 0.0, 0.0],
        # 温柔: 平静为主 + 高兴
        "温柔": [0.3, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.5],
        # 坚定: 生气(力量感)为主 + 平静(沉稳)
        "坚定": [0.0, 0.45, 0.0, 0.0, 0.0, 0.0, 0.0, 0.35],
        # 哀求: 伤心为主 + 害怕辅助
        "哀求": [0.0, 0.0, 0.55, 0.25, 0.0, 0.0, 0.0, 0.0],
    }

    # === 强度倍率 ===
    # 注意: 这里的值会直接作为向量维度值(基础情绪)或缩放倍率基准(复合情绪)
    # 官方 webui 滑块范围 0~1.0, 经 normalize_emo_vec 加权后总和约束 ≤ 0.8
    # 提高基准值让情绪表现更明显 (之前 0.5 太弱听不出来)
    intensity_map = {"微弱": 0.3, "稍弱": 0.5, "中等": 0.7, "较强": 0.85, "强烈": 1.0}

    scale = intensity_map.get(intensity, 0.5)

    # 1. 先尝试基础情绪
    if emotion in BASIC_EMOTIONS:
        vec = [0.0] * 8
        idx = BASIC_EMOTIONS.index(emotion)
        vec[idx] = scale
        return vec

    # 2. 再尝试复合情绪
    if emotion in COMPOUND_EMOTIONS:
        base_vec = COMPOUND_EMOTIONS[emotion]
        # 用强度倍率缩放 (中等=0.7 时向量保持原值*0.7/0.7=1x, 强烈=1.0 时放大约1.43x)
        # 以 0.7 为基准, 让 "中等" 强度下复合情绪保持设计值
        ratio = scale / 0.7
        vec = [v * ratio for v in base_vec]
        # 确保总和不超过 0.8 (Index-TTS 归一化约束)
        total = sum(vec)
        if total > 0.8:
            factor = 0.8 / total
            vec = [v * factor for v in vec]
        return vec

    # 3. 未知情绪, 返回零向量 (平静)
    return [0.0] * 8


async def tts_worker(app: FastAPI):
    q = app.state.tts_queue
    while True:
        project_id, dto = await q.get()
        db = SessionLocal()
        try:
            line_service = get_line_service(db)
            role_service = get_role_service(db)
            voice_service = get_voice_service(db)
            multi_emotion_service = get_multi_emotion_voice_service(db)
            project_service = get_project_service(db)
            emotion_service = get_emotion_service(db)
            strength_service = get_strength_service(db)

            # line_service.update_line(dto.id, {"status": "processing"})
            await manager.broadcast(
                {
                    "event": "line_update",
                    "line_id": dto.id,
                    "status": "processing",
                    "progress": q.qsize(),
                    "meta": f"角色 {dto.role_id} 开始生成",
                }
            )

            role = role_service.get_role(dto.role_id)
            voice = voice_service.get_voice(role.default_voice_id)
            reference_path = voice.reference_path

            # if voice.is_multi_emotion == 1:
            #     # 使用多音色
            #     multi_emotion = multi_emotion_service.get_multi_emotion_voice_by_voice_id_emotion_id_strength_id(voice.id, dto.emotion_id, dto.strength_id)
            #     if multi_emotion is not None:
            #         reference_path = multi_emotion.reference_path

            # 9.13
            emotion = emotion_service.get_emotion(dto.emotion_id)
            strength = strength_service.get_strength(dto.strength_id)
            # 拼接
            # emo_text = f"{strength.name}的{emotion.name} "
            # if emotion.name is "解说":
            #     emo_text = None
            emo_text = None
            emo_vector = emotion_text_to_vector(emotion.name, strength.name)

            project = project_service.get_project(project_id)

            # 获取项目语言设置
            project_language = getattr(project, "language", None)

            # 纯协程调用，无需线程池
            await asyncio.wait_for(
                line_service.generate_audio_async(
                    reference_path,
                    project.tts_provider_id,
                    dto.text_content,
                    emo_text,
                    emo_vector,
                    dto.audio_path,
                    language=project_language,
                ),
                timeout=TTS_TIMEOUT_SECONDS,
            )

            line_service.update_line(dto.id, {"status": "done"})
            await manager.broadcast(
                {
                    "event": "line_update",
                    "line_id": dto.id,
                    "status": "done",
                    "progress": q.qsize(),
                    "meta": "生成完成",
                    "audio_path": dto.audio_path,
                }
            )
            # 发送给前端，队列中剩余的数量
            await manager.broadcast(
                {
                    "event": "tts_queue_rest",
                    "queue_rest": q.qsize(),
                    "project_id": project_id,
                }
            )

        except Exception as e:
            try:
                line_service.update_line(dto.id, {"status": "failed"})
            except Exception:
                pass
            await manager.broadcast(
                {
                    "event": "line_update",
                    "line_id": dto.id,
                    "status": "failed",
                    "progress": q.qsize(),
                    "meta": f"失败: {e}",
                }
            )

        finally:

            db.close()
            q.task_done()
