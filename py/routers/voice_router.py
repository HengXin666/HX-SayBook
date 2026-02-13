import os
import shutil
from typing import List

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from py.core.config import get_data_dir
from py.core.response import Res
from py.db.database import get_db
from py.dto.tts_provider_dto import TTSProviderResponseDTO
from py.dto.voice_dto import (
    VoiceResponseDTO,
    VoiceCreateDTO,
    VoiceExportDTO,
    VoiceImportDTO,
    VoiceImportResultDTO,
    VoiceAudioProcessDTO,
    VoiceCopyDTO,
)
from py.entity.voice_entity import VoiceEntity
from py.repositories.multi_emotion_voice_repository import MultiEmotionVoiceRepository

from py.repositories.tts_provider_repository import TTSProviderRepository
from py.repositories.voice_repository import VoiceRepository

from py.services.tts_provider_service import TTSProviderService
from py.services.voice_service import VoiceService

router = APIRouter(prefix="/voices", tags=["Voices"])


# 依赖注入（实际项目可用 DI 容器）


def get_voice_service(db: Session = Depends(get_db)) -> VoiceService:
    repository = VoiceRepository(db)
    multi_emotion_voice_repository = MultiEmotionVoiceRepository(db)
    return VoiceService(repository, multi_emotion_voice_repository)


def get_tts_provider_service(db: Session = Depends(get_db)) -> TTSProviderService:
    repository = TTSProviderRepository(db)
    return TTSProviderService(repository)


# ====== 静态路由放在动态路由之前，避免路径冲突 ======


@router.post(
    "/upload",
    response_model=Res[VoiceResponseDTO],
    summary="上传音色（含参考音频文件）",
    description="通过 multipart/form-data 上传参考音频文件并创建/更新音色",
)
async def upload_voice(
    name: str = Form(...),
    tts_provider_id: int = Form(1),
    description: str = Form(None),
    voice_id: int = Form(None),
    file: UploadFile = File(None),
    voice_service: VoiceService = Depends(get_voice_service),
):
    """上传音色参考音频文件，支持新建和更新"""
    try:
        reference_path = None

        # 如果有上传文件，保存到数据目录
        if file and file.filename:
            # 检查文件类型
            allowed_ext = {".wav", ".mp3", ".flac", ".ogg", ".m4a"}
            file_ext = os.path.splitext(file.filename)[1].lower()
            if file_ext not in allowed_ext:
                return Res(
                    data=None,
                    code=400,
                    message=f"不支持的音频格式: {file_ext}，支持: {', '.join(allowed_ext)}",
                )

            # 保存到数据目录 / user_voices /
            voices_dir = os.path.join(get_data_dir(), "user_voices")
            os.makedirs(voices_dir, exist_ok=True)

            # 使用音色名作为文件名，避免冲突
            safe_name = name.replace("/", "_").replace("\\", "_")
            dest_file = os.path.join(voices_dir, f"{safe_name}{file_ext}")

            with open(dest_file, "wb") as f:
                content = await file.read()
                f.write(content)

            reference_path = dest_file

        # 更新已有音色
        if voice_id is not None:
            voice = voice_service.get_voice(voice_id)
            if voice is None:
                return Res(data=None, code=404, message="音色不存在")

            update_data = {
                "name": name,
                "tts_provider_id": voice.tts_provider_id,
                "description": description,
            }
            if reference_path:
                update_data["reference_path"] = reference_path

            voice_service.update_voice(voice_id, update_data)
            updated = voice_service.get_voice(voice_id)
            res = VoiceResponseDTO(**updated.__dict__)
            return Res(data=res, code=200, message="更新成功")

        # 创建新音色
        entity = VoiceEntity(
            name=name,
            tts_provider_id=tts_provider_id,
            reference_path=reference_path,
            description=description,
        )
        result = voice_service.create_voice(entity)
        if result is None:
            return Res(data=None, code=400, message=f"音色 '{name}' 已存在")

        res = VoiceResponseDTO(**result.__dict__)
        return Res(data=res, code=200, message="创建成功")
    except Exception as e:
        return Res(data=None, code=500, message=f"上传失败: {str(e)}")


@router.post(
    "/process-audio",
    response_model=Res[str],
    summary="处理音色参考音频",
    description="对音色的参考音频进行处理（变速、音量、裁剪等）",
)
def process_voice_audio(
    dto: VoiceAudioProcessDTO, voice_service: VoiceService = Depends(get_voice_service)
):
    """处理音色参考音频"""
    try:
        result = voice_service.process_audio(dto)
        if result:
            return Res(data=dto.audio_path, code=200, message="处理成功")
        else:
            return Res(data=None, code=400, message="处理失败")
    except FileNotFoundError as e:
        return Res(data=None, code=404, message=f"音频文件不存在: {str(e)}")
    except Exception as e:
        return Res(data=None, code=500, message=f"处理失败: {str(e)}")


@router.post(
    "/export",
    response_model=Res[str],
    summary="导出音色库",
    description="将指定TTS供应商下的音色打包到zip文件（可选传ids仅导出选中）",
)
def export_voices(
    dto: VoiceExportDTO, voice_service: VoiceService = Depends(get_voice_service)
):
    """导出音色库到zip文件"""
    try:
        result = voice_service.export_voices(
            dto.tts_provider_id, dto.export_path, dto.ids
        )
        if result:
            return Res(data=result, code=200, message="导出成功")
        else:
            return Res(data=None, code=400, message="没有可导出的音色")
    except Exception as e:
        return Res(data=None, code=500, message=f"导出失败: {str(e)}")


@router.post(
    "/import",
    response_model=Res[VoiceImportResultDTO],
    summary="导入音色库",
    description="从zip文件导入音色库，将音频文件复制到指定目录，已存在的音色会跳过",
)
def import_voices(
    dto: VoiceImportDTO, voice_service: VoiceService = Depends(get_voice_service)
):
    """从zip文件导入音色库"""
    try:
        success_count, skipped_count, skipped_names = voice_service.import_voices(
            dto.tts_provider_id, dto.zip_path, dto.target_dir
        )
        result = VoiceImportResultDTO(
            success_count=success_count,
            skipped_count=skipped_count,
            skipped_names=skipped_names,
        )
        return Res(
            data=result,
            code=200,
            message=f"导入完成：成功{success_count}个，跳过{skipped_count}个",
        )
    except FileNotFoundError as e:
        return Res(data=None, code=404, message=str(e))
    except ValueError as e:
        return Res(data=None, code=400, message=str(e))
    except Exception as e:
        return Res(data=None, code=500, message=f"导入失败: {str(e)}")


@router.post(
    "/copy",
    response_model=Res[VoiceResponseDTO],
    summary="复制音色",
    description="复制现有音色，包括音频文件，生成新的音色记录",
)
def copy_voice(
    dto: VoiceCopyDTO, voice_service: VoiceService = Depends(get_voice_service)
):
    """复制音色"""
    try:
        new_voice = voice_service.copy_voice(
            dto.source_voice_id, dto.new_name, dto.target_dir
        )
        res = VoiceResponseDTO(**new_voice.__dict__)
        return Res(data=res, code=200, message="复制成功")
    except ValueError as e:
        return Res(data=None, code=400, message=str(e))
    except Exception as e:
        return Res(data=None, code=500, message=f"复制失败: {str(e)}")


@router.get(
    "/audio-file",
    summary="获取音频文件",
    description="根据文件路径返回音频文件，用于前端播放试听",
)
def get_audio_file(path: str):
    """根据路径返回音频文件"""
    import os

    if not path or not os.path.exists(path):
        raise HTTPException(status_code=404, detail=f"音频文件不存在: {path}")

    # 根据扩展名返回正确的 media_type
    ext = os.path.splitext(path)[1].lower()
    media_type_map = {
        ".wav": "audio/wav",
        ".mp3": "audio/mpeg",
        ".flac": "audio/flac",
        ".ogg": "audio/ogg",
        ".m4a": "audio/mp4",
    }
    media_type = media_type_map.get(ext, "audio/wav")
    return FileResponse(path, media_type=media_type)


@router.get(
    "",
    response_model=Res[List[VoiceResponseDTO]],
    summary="查询音色列表",
    description="根据可选的tts_provider_id查询音色列表，不传则默认查tts_provider_id=1",
)
def get_voices_by_query(
    tts_provider_id: int = 1, voice_service: VoiceService = Depends(get_voice_service)
):
    entities = voice_service.get_all_voices(tts_provider_id)
    if entities:
        res = [VoiceResponseDTO(**e.__dict__) for e in entities]
        return Res(data=res, code=200, message="查询成功")
    else:
        return Res(data=[], code=200, message="暂无音色")


@router.get(
    "/tts/{tts_provider_id}",
    response_model=Res[List[VoiceResponseDTO]],
    summary="查询tts供应商下的所有音色",
    description="根据tts供应商id,查询tts供应商下的所有音色信息",
)
def get_all_voices(
    tts_provider_id: int, voice_service: VoiceService = Depends(get_voice_service)
):
    entities = voice_service.get_all_voices(tts_provider_id)
    if entities:
        res = [VoiceResponseDTO(**e.__dict__) for e in entities]
        return Res(data=res, code=200, message="查询成功")
    else:
        return Res(data=[], code=404, message="项目不存在音色")


@router.post(
    "",
    response_model=Res[VoiceResponseDTO],
    summary="创建音色",
    description="根据项目ID创建音色，音色名称在同一项目下不可重复",
)
def create_voice(
    dto: VoiceCreateDTO,
    voice_service: VoiceService = Depends(get_voice_service),
    tts_provider_service: TTSProviderService = Depends(get_tts_provider_service),
):
    """创建音色"""
    try:
        # DTO → Entity
        entity = VoiceEntity(**dto.__dict__)
        # 判断tts_id是否存在
        tts_provider = tts_provider_service.get_tts_provider(dto.tts_provider_id)

        if tts_provider is None:
            return Res(
                data=None,
                code=400,
                message=f"tts服务提供商 '{dto.tts_provider_id}' 不存在",
            )
        # 调用 Service 创建项目（返回 True/False）
        entityRes = voice_service.create_voice(entity)

        # 返回统一 Response
        if entityRes is not None:
            # 创建成功，可以返回 DTO 或者部分字段
            res = VoiceResponseDTO(**entityRes.__dict__)
            return Res(data=res, code=200, message="创建成功")
        else:
            return Res(data=None, code=400, message=f"音色 '{entity.name}' 已存在")

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ====== 动态路由放在最后 ======


@router.get(
    "/{voice_id}",
    response_model=Res[VoiceResponseDTO],
    summary="查询音色",
    description="根据音色id查询音色信息",
)
def get_voice(voice_id: int, voice_service: VoiceService = Depends(get_voice_service)):
    entity = voice_service.get_voice(voice_id)
    if entity:
        res = VoiceResponseDTO(**entity.__dict__)
        return Res(data=res, code=200, message="查询成功")
    else:
        return Res(data=None, code=404, message="项目不存在")


# 修改，传入的参数是id
@router.put(
    "/{voice_id}",
    response_model=Res[VoiceCreateDTO],
    summary="修改音色信息",
    description="根据音色id修改音色信息,并且不能修改项目id",
)
def update_voice(
    voice_id: int,
    dto: VoiceCreateDTO,
    voice_service: VoiceService = Depends(get_voice_service),
):
    voice = voice_service.get_voice(voice_id)
    if voice is None:
        return Res(data=None, code=404, message="音色不存在")
    res = voice_service.update_voice(voice_id, dto.dict())
    if res:
        return Res(data=dto, code=200, message="修改成功")
    else:
        return Res(data=None, code=400, message="修改失败")


# 根据 id，删除
@router.delete(
    "/{voice_id}",
    response_model=Res,
    summary="删除音色",
    description="根据音色id删除音色信息",
)
def delete_voice(
    voice_id: int, voice_service: VoiceService = Depends(get_voice_service)
):
    success = voice_service.delete_voice(voice_id)
    if success:
        return Res(data=None, code=200, message="删除成功")
    else:
        return Res(data=None, code=400, message="删除失败或音色不存在")


# tts_provider的查询和修改
# @router.get("/tts/provider/{tts_provider_id}", response_model=Res[TTSProviderResponseDTO])
# def get_tts_provider(tts_provider_id: int, tts_provider_service: TTSProviderService = Depends(get_tts_provider_service)):
#     tts_provider = tts_provider_service.get_tts_provider(tts_provider_id)
#     if tts_provider:
#         res = TTSProviderResponseDTO(**tts_provider.__dict__)
#         return Res(data=res, code=200, message="查询成功")
#     else:
#         return Res(data=None, code=404, message="tts服务提供商不存在")
#
# # tts_provider的修改
# @router.put("/tts/provider/{tts_provider_id}", response_model=Res[TTSProviderResponseDTO])
# def update_tts_provider(tts_provider_id: int, dto: TTSProviderResponseDTO, tts_provider_service: TTSProviderService = Depends(get_tts_provider_service)):
#     # 先判断是否存在
#     tts_provider = tts_provider_service.get_tts_provider(tts_provider_id)
#     if tts_provider is None:
#         return Res(data=None, code=404, message="tts服务提供商不存在")
#     tts_provider = tts_provider_service.update_tts_provider(tts_provider_id, dto.dict(exclude_unset=True))
#     if tts_provider:
#         return Res(data=None, code=200, message="修改成功")
#     else:
#         return Res(data=None, code=400, message="修改失败")
