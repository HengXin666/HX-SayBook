import asyncio
import os
import zipfile
import io
from concurrent.futures import ThreadPoolExecutor
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Body, Request, Query
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session

from py.core.config import getConfigPath
from py.core.response import Res
from py.core.ws_manager import manager
from py.db.database import get_db, SessionLocal
from py.dto.line_dto import (
    LineResponseDTO,
    LineCreateDTO,
    LineOrderDTO,
    LineAudioProcessDTO,
)
from py.entity.line_entity import LineEntity
from py.repositories.chapter_repository import ChapterRepository
from py.repositories.llm_provider_repository import LLMProviderRepository
from py.repositories.multi_emotion_voice_repository import MultiEmotionVoiceRepository
from py.repositories.project_repository import ProjectRepository
from py.repositories.line_repository import LineRepository
from py.repositories.role_repository import RoleRepository
from py.repositories.tts_provider_repository import TTSProviderRepository
from py.repositories.voice_repository import VoiceRepository
from py.services.chapter_service import ChapterService
from py.services.project_service import ProjectService
from py.services.line_service import LineService
from py.services.role_service import RoleService
from py.services.voice_service import VoiceService

router = APIRouter(prefix="/lines", tags=["Lines"])


# 依赖注入（实际项目可用 DI 容器）


def get_line_service(db: Session = Depends(get_db)) -> LineService:
    repository = LineRepository(db)
    role_repository = RoleRepository(db)
    tts_repository = TTSProviderRepository(db)
    return LineService(repository, role_repository, tts_repository)


def get_project_service(db: Session = Depends(get_db)) -> ProjectService:
    repository = ProjectRepository(db)
    return ProjectService(repository)


def get_chapter_service(db: Session = Depends(get_db)) -> ChapterService:
    repository = ChapterRepository(db)
    return ChapterService(repository)


def get_voice_service(db: Session = Depends(get_db)) -> VoiceService:
    repository = VoiceRepository(db)
    multi_emotion_voice_repository = MultiEmotionVoiceRepository(db)
    return VoiceService(repository, multi_emotion_voice_repository)


def get_role_service(db: Session = Depends(get_db)) -> RoleService:
    repository = RoleRepository(db)
    return RoleService(repository)


@router.get(
    "/audio-file",
    summary="获取音频文件",
    description="根据文件路径返回音频文件，用于前端播放试听",
)
def get_audio_file(path: str):
    """根据路径返回音频文件"""
    if not path or not os.path.exists(path):
        raise HTTPException(status_code=404, detail=f"音频文件不存在: {path}")
    return FileResponse(path, media_type="audio/wav")


# 合并多章节音频为 MP3 导出（注意：此路由必须在 /{project_id} 之前定义，否则会被路径参数拦截）
from pydantic import BaseModel


class ValidateAudioRequest(BaseModel):
    """音频完整性校验请求"""
    project_id: int
    chapter_ids: List[int]


@router.post("/validate-audio", response_model=Res)
async def validate_chapters_audio(
    req: ValidateAudioRequest,
    line_service: LineService = Depends(get_line_service),
    chapter_service: ChapterService = Depends(get_chapter_service),
):
    """
    校验指定章节的音频完整性。
    检查哪些章节有台词但缺少音频文件，帮助定位合并导出时音频/字幕对不上的问题。
    """
    if not req.chapter_ids:
        return Res(data=None, code=400, message="请选择要校验的章节")

    chapter_titles = {}
    for cid in req.chapter_ids:
        ch = chapter_service.get_chapter(cid)
        if ch:
            chapter_titles[cid] = ch.title

    result = line_service.validate_chapters_audio(req.chapter_ids, chapter_titles)
    if result["missing_audio"] > 0:
        return Res(
            data=result,
            code=200,
            message=f"发现 {result['chapters_with_missing']} 个章节存在音频缺失，共 {result['missing_audio']} 条台词缺少音频",
        )
    return Res(
        data=result,
        code=200,
        message=f"全部 {result['total_lines']} 条台词音频完整，可以安全合并导出",
    )


class MergeExportRequest(BaseModel):
    """合并导出请求"""

    project_id: int
    chapter_ids: List[int]  # 要合并的章节ID列表
    group_size: int = 0  # 每组章节数，0表示全部合并为一个文件
    max_duration_minutes: float = 0  # 每段最大时长（分钟），0表示不限制


class MergeZipRequest(BaseModel):
    """打包下载请求"""

    project_id: int
    files: List[dict]  # [{"url": ..., "name": ...}] 需要打包的文件
    include_subtitles: bool = True  # 是否包含字幕文件


@router.post("/merge-export", response_model=Res)
async def merge_export_audio(
    req: MergeExportRequest,
    line_service: LineService = Depends(get_line_service),
    project_service: ProjectService = Depends(get_project_service),
    chapter_service: ChapterService = Depends(get_chapter_service),
):
    """
    合并多章节音频为 MP3 文件（异步执行，不阻塞主线程）。
    - group_size=0: 所有章节合并为一个MP3
    - group_size=N: 每N个章节合并为一个MP3
    - max_duration_minutes>0: 按时长分段，以章节为最小单位（不在章节中间截断）
    """
    project = project_service.get_project(req.project_id)
    if not project:
        return Res(data=None, code=400, message="项目不存在")

    if not req.chapter_ids:
        return Res(data=None, code=400, message="请选择要合并的章节")

    # 获取章节标题映射
    chapter_titles = {}
    for cid in req.chapter_ids:
        ch = chapter_service.get_chapter(cid)
        if ch:
            chapter_titles[cid] = ch.title

    project_root_path = project.project_root_path or getConfigPath()

    try:
        # 使用 asyncio.to_thread 将阻塞的合并操作放入线程池异步执行
        result = await asyncio.to_thread(
            line_service.merge_chapters_audio,
            project_root_path=project_root_path,
            project_id=req.project_id,
            chapter_ids=req.chapter_ids,
            chapter_titles=chapter_titles,
            group_size=req.group_size,
            max_duration_minutes=req.max_duration_minutes,
        )

        if not result["files"]:
            return Res(
                data=None,
                code=400,
                message=result.get("message", "没有找到可合并的音频文件"),
            )

        return Res(
            data=result,
            code=200,
            message=f"合并完成，共生成 {len(result['files'])} 个文件",
        )

    except Exception as e:
        import traceback

        traceback.print_exc()
        return Res(data=None, code=500, message=f"合并失败: {str(e)}")


@router.post("/merge-export/zip")
async def merge_export_zip(
    req: MergeZipRequest,
    project_service: ProjectService = Depends(get_project_service),
):
    """
    将合并导出的文件一键打包为 ZIP 下载。
    支持选择是否包含字幕文件。
    """
    project = project_service.get_project(req.project_id)
    if not project:
        raise HTTPException(status_code=400, detail="项目不存在")

    project_root_path = project.project_root_path or getConfigPath()

    def _build_zip() -> io.BytesIO:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for file_info in req.files:
                url = file_info.get("url", "")
                name = file_info.get("name", "")
                subtitles = file_info.get("subtitles", {})

                # 从 static_url 反推本地文件路径
                if url.startswith("/static/audio/"):
                    rel = url[len("/static/audio/"):]
                    local_path = os.path.join(project_root_path, rel)
                    if os.path.isfile(local_path):
                        zf.write(local_path, name)

                # 打包字幕文件
                if req.include_subtitles and subtitles:
                    base_name = os.path.splitext(name)[0]
                    for fmt, sub_url in subtitles.items():
                        if sub_url and sub_url.startswith("/static/audio/"):
                            sub_rel = sub_url[len("/static/audio/"):]
                            sub_local = os.path.join(project_root_path, sub_rel)
                            if os.path.isfile(sub_local):
                                zf.write(sub_local, f"{base_name}.{fmt}")
        buf.seek(0)
        return buf

    try:
        zip_buf = await asyncio.to_thread(_build_zip)
        return StreamingResponse(
            zip_buf,
            media_type="application/zip",
            headers={"Content-Disposition": "attachment; filename=merged_audio.zip"},
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"打包失败: {str(e)}")


@router.get("/merge-history/{project_id}", response_model=Res)
async def get_merge_history(
    project_id: int,
    project_service: ProjectService = Depends(get_project_service),
):
    """
    获取合并导出历史：扫描本地 merged_audio 目录中已有的 MP3 文件。
    """
    project = project_service.get_project(project_id)
    if not project:
        return Res(data=None, code=400, message="项目不存在")

    project_root_path = project.project_root_path or getConfigPath()
    merge_dir = os.path.join(project_root_path, str(project_id), "merged_audio")

    if not os.path.isdir(merge_dir):
        return Res(data={"files": []}, code=200, message="暂无合并历史")

    def _scan_history():
        result_files = []
        for fname in sorted(os.listdir(merge_dir)):
            if not fname.endswith(".mp3"):
                continue
            mp3_path = os.path.join(merge_dir, fname)
            if not os.path.isfile(mp3_path):
                continue

            rel_path = os.path.relpath(mp3_path, project_root_path)
            static_url = f"/static/audio/{rel_path}"

            # 获取文件大小
            file_size = os.path.getsize(mp3_path)
            size_mb = round(file_size / 1024 / 1024, 2)

            # 获取文件修改时间
            import datetime
            mtime = os.path.getmtime(mp3_path)
            mtime_str = datetime.datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M:%S")

            # 查找对应字幕文件
            base_name = os.path.splitext(fname)[0]
            subtitle_urls = {}
            for fmt in ["srt", "ass"]:
                sub_path = os.path.join(merge_dir, f"{base_name}.{fmt}")
                if os.path.isfile(sub_path):
                    sub_rel = os.path.relpath(sub_path, project_root_path)
                    subtitle_urls[fmt] = f"/static/audio/{sub_rel}"

            result_files.append({
                "name": fname,
                "url": static_url,
                "size_mb": size_mb,
                "modified_time": mtime_str,
                "subtitles": subtitle_urls,
            })

        # 按修改时间倒序
        result_files.sort(key=lambda x: x["modified_time"], reverse=True)
        return result_files

    try:
        files = await asyncio.to_thread(_scan_history)
        return Res(
            data={"files": files},
            code=200,
            message=f"找到 {len(files)} 个合并历史文件",
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        return Res(data=None, code=500, message=f"获取历史失败: {str(e)}")


class DeleteMergeFileRequest(BaseModel):
    """删除合并历史文件请求"""

    project_id: int
    file_name: str  # 要删除的文件名


@router.post("/merge-history/delete", response_model=Res)
async def delete_merge_history_file(
    req: DeleteMergeFileRequest,
    project_service: ProjectService = Depends(get_project_service),
):
    """
    删除单个合并历史文件（包括对应的字幕文件）。
    """
    project = project_service.get_project(req.project_id)
    if not project:
        return Res(data=None, code=400, message="项目不存在")

    project_root_path = project.project_root_path or getConfigPath()
    merge_dir = os.path.join(project_root_path, str(req.project_id), "merged_audio")

    if not os.path.isdir(merge_dir):
        return Res(data=None, code=400, message="合并目录不存在")

    def _delete_file():
        deleted = []
        base_name = os.path.splitext(req.file_name)[0]
        # 删除MP3文件
        mp3_path = os.path.join(merge_dir, req.file_name)
        if os.path.isfile(mp3_path):
            os.remove(mp3_path)
            deleted.append(req.file_name)
        # 删除对应字幕文件
        for fmt in ["srt", "ass"]:
            sub_path = os.path.join(merge_dir, f"{base_name}.{fmt}")
            if os.path.isfile(sub_path):
                os.remove(sub_path)
                deleted.append(f"{base_name}.{fmt}")
        return deleted

    try:
        deleted = await asyncio.to_thread(_delete_file)
        if not deleted:
            return Res(data=None, code=400, message=f"文件 {req.file_name} 不存在")
        return Res(data={"deleted": deleted}, code=200, message=f"已删除 {len(deleted)} 个文件")
    except Exception as e:
        import traceback
        traceback.print_exc()
        return Res(data=None, code=500, message=f"删除失败: {str(e)}")


@router.post("/merge-history/clear/{project_id}", response_model=Res)
async def clear_merge_history(
    project_id: int,
    project_service: ProjectService = Depends(get_project_service),
):
    """
    一键清空所有合并历史文件（MP3 + 字幕）。
    """
    project = project_service.get_project(project_id)
    if not project:
        return Res(data=None, code=400, message="项目不存在")

    project_root_path = project.project_root_path or getConfigPath()
    merge_dir = os.path.join(project_root_path, str(project_id), "merged_audio")

    if not os.path.isdir(merge_dir):
        return Res(data={"deleted_count": 0}, code=200, message="合并目录不存在，无需清空")

    def _clear_all():
        deleted_count = 0
        for fname in os.listdir(merge_dir):
            fpath = os.path.join(merge_dir, fname)
            if os.path.isfile(fpath) and fname.endswith((".mp3", ".srt", ".ass")):
                os.remove(fpath)
                deleted_count += 1
        return deleted_count

    try:
        count = await asyncio.to_thread(_clear_all)
        return Res(data={"deleted_count": count}, code=200, message=f"已清空 {count} 个文件")
    except Exception as e:
        import traceback
        traceback.print_exc()
        return Res(data=None, code=500, message=f"清空失败: {str(e)}")


@router.post(
    "/{project_id}",
    response_model=Res[LineResponseDTO],
    summary="创建台词",
    description="根据项目ID创建台词",
)
def create_line(
    project_id: int,
    dto: LineCreateDTO,
    line_service: LineService = Depends(get_line_service),
    project_service: ProjectService = Depends(get_project_service),
    chapter_service: ChapterService = Depends(get_chapter_service),
):
    """创建台词"""
    try:
        # DTO → Entity
        entity = LineEntity(**dto.__dict__)
        # 判断project_id是否存在
        project = project_service.get_project(project_id)
        if project is None:
            return Res(data=None, code=400, message=f"项目 '{project_id}' 不存在")

        chapter = chapter_service.get_chapter(dto.chapter_id)
        if chapter is None:
            return Res(data=None, code=400, message=f"章节 '{dto.chapter_id}' 不存在")
        # 调用 Service 创建项目（返回 True/False）

        entityRes = line_service.create_line(entity)

        # 新增台词,这里搞个audio_path
        audio_path = os.path.join(
            project.project_root_path, str(project_id), str(dto.chapter_id), "audio"
        )
        os.makedirs(audio_path, exist_ok=True)
        res_path = os.path.join(audio_path, "id_" + str(entityRes.id) + ".wav")
        line_service.update_line(entityRes.id, {"audio_path": res_path})

        # 返回统一 Response
        if entityRes is not None:
            # 创建成功，可以返回 DTO 或者部分字段
            res = LineResponseDTO(**entityRes.__dict__)
            return Res(data=res, code=200, message="创建成功")
        else:
            return Res(data=None, code=400, message=f"台词 '{entity.name}' 已存在")

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get(
    "/{line_id}",
    response_model=Res[LineResponseDTO],
    summary="查询台词",
    description="根据台词id查询台词信息",
)
def get_line(line_id: int, line_service: LineService = Depends(get_line_service)):
    entity = line_service.get_line(line_id)
    if entity:
        res = LineResponseDTO(**entity.__dict__)
        return Res(data=res, code=200, message="查询成功")
    else:
        return Res(data=None, code=404, message="项目不存在")


@router.get(
    "/lines/{chapter_id}",
    response_model=Res[List[LineResponseDTO]],
    summary="查询章节下的所有台词",
    description="根据章节id查询章节下的所有台词信息",
)
def get_all_lines(
    chapter_id: int, line_service: LineService = Depends(get_line_service)
):
    entities = line_service.get_all_lines(chapter_id)
    if entities:
        res = [LineResponseDTO(**e.__dict__) for e in entities]
        return Res(data=res, code=200, message="查询成功")
    else:
        return Res(data=[], code=200, message="章节不存在台词")


# 修改，传入的参数是id
@router.put(
    "/{line_id}",
    response_model=Res[LineCreateDTO],
    summary="修改台词信息",
    description="根据台词id修改台词信息,并且不能修改章节id",
)
def update_line(
    line_id: int,
    dto: LineCreateDTO,
    line_service: LineService = Depends(get_line_service),
):
    line = line_service.get_line(line_id)
    if line is None:
        return Res(data=None, code=404, message="台词不存在")
    res = line_service.update_line(line_id, dto.dict(exclude_unset=True))
    if res:
        return Res(data=dto, code=200, message="修改成功")
    else:
        return Res(data=None, code=400, message="修改失败")


# 根据id，删除
@router.delete(
    "/{line_id}",
    response_model=Res,
    summary="删除台词",
    description="根据台词id删除台词信息",
)
def delete_line(line_id: int, line_service: LineService = Depends(get_line_service)):
    success = line_service.delete_line(line_id)
    if success:
        return Res(data=None, code=200, message="删除成功")
    else:
        return Res(data=None, code=400, message="删除失败或台词不存在")


# 删除章节下所有台词
@router.delete(
    "/lines/{chapter_id}",
    response_model=Res,
    summary="删除章节下所有台词",
    description="根据章节id删除章节下的所有台词信息",
)
def delete_all_lines(
    chapter_id: int, line_service: LineService = Depends(get_line_service)
):
    success = line_service.delete_all_lines(chapter_id)
    if success:
        return Res(data=None, code=200, message="删除成功")
    else:
        return Res(data=None, code=400, message="删除失败或台词不存在")


@router.put("/batch/orders", response_model=Res[bool])
def batch_update_line_order(
    line_orders: List[LineOrderDTO] = Body(...),  # 关键：明确从 body 读取“数组”
    line_service: LineService = Depends(get_line_service),
):
    res = line_service.batch_update_line_order(line_orders)
    return Res(data=res, code=200, message="更新成功")


# 完成配音时候，更新音频路径，保证顺序一致
@router.put("/{line_id}/audio_path", response_model=Res[bool])
def update_line_audio_path(
    line_id: int,
    dto: LineCreateDTO,  # 关键：明确从 body 读取“数组”
    line_service: LineService = Depends(get_line_service),
):
    res = line_service.update_audio_path(line_id, dto)
    if not res:
        return Res(data=None, code=400, message="更新失败")
    return Res(data=res, code=200, message="更新成功")


@router.post("/generate-audio/{project_id}/{chapter_id}")
def generate_audio(
    request: Request,
    project_id: int,
    dto: LineCreateDTO,
    line_service: LineService = Depends(get_line_service),
):
    q = request.app.state.tts_queue  # 👈 永远拿到已初始化的同一份队列
    if q.full():
        # 可选：带上 Retry-After 头
        raise HTTPException(status_code=429, detail="队列已满，请稍后重试")
    q.put_nowait((project_id, dto))
    #
    line_service.update_line(dto.id, {"status": "processing"})
    # manager.broadcast({
    #     "event": "line_update",
    #     "line_id": dto.id,
    #     "status": "processing",
    #     "progress":  q.qsize(),
    #     "meta": f"角色 {dto.role_id} 开始生成"
    # })
    print("队列剩余数量:", q.qsize())
    return {"code": 200, "message": "已入队", "data": {"line_id": dto.id}}


# 改为异步任务

# @router.post("/generate-audio/{project_id}/{chapter_id}")
# async def generate_audio(project_id : int, chapter_id: int, dto: LineCreateDTO):
#     # 立即返回，不阻塞
#     asyncio.create_task(_run_line_tts(project_id,dto))
#     return {"code": 200, "message": "已入队", "data": {"line_id": dto.id}}
#
#
# TTS_EXECUTOR = ThreadPoolExecutor(max_workers=4)  # 线程池大小
# TTS_SEMAPHORE = asyncio.Semaphore(1)              # 最多 4 个并行 TTS
# async def _run_line_tts(project_id:int,dto: LineCreateDTO):
#     db = SessionLocal()
#     line_service = get_line_service(db)
#     role_service = get_role_service( db)
#     voice_service = get_voice_service(db)
#     project_service = get_project_service(db)
#     try:
#         # 1) 更新为 running
#         line_service.update_line(dto.id, {"status": "processing"})
#         print("开始生成")
#         await manager.broadcast({
#             "event": "line_update",
#             "line_id": dto.id,
#             "status": "processing",
#             "progress": 0,
#             "meta": f"角色 {dto.role_id} 开始生成"
#         })
#
#         # 2) 模拟进度
#         # 获取角色绑定的音色的reference_path
#         role = role_service.get_role(dto.role_id)
#         voice = voice_service.get_voice(role.default_voice_id)
#         project = project_service.get_project(project_id)
#         save_path = dto.audio_path
#         loop = asyncio.get_running_loop()
#         async with TTS_SEMAPHORE:
#             # 可选：设置超时，防挂死
#             try:
#                 res = await asyncio.wait_for(
#                     loop.run_in_executor(
#                         TTS_EXECUTOR,                 # ✅ 用自建线程池
#                         line_service.generate_audio,
#                         voice.reference_path,
#                         project.tts_provider_id,      # 若引擎需要 base_url，就换成 project.tts_base_url
#                         dto.text_content,
#                         save_path
#                     ),
#                     timeout=120  # 例：最多等 5 分钟
#                 )
#             except asyncio.TimeoutError:
#                 raise RuntimeError("TTS 超时")
#
#         # res = chapter_service.generate_audio(voice.reference_path,project.tts_provider_id,dto.text_content,save_path=save_path)
#         # 3) 真正合成
#         line_service.update_line(dto.id, {"status": "done"})
#
#         # 4) 广播完成
#         await manager.broadcast({
#             "event": "line_update",
#             "line_id": dto.id,
#             "status": "done",
#             "progress": 100,
#             "meta": "生成完成",
#             "audio_path": dto.audio_path
#         })
#     except Exception as e:
#         line_service.update_line(dto.id, {"status": "failed"})
#         await manager.broadcast({
#             "event": "line_update",
#             "line_id": dto.id,
#             "status": "failed",
#             "progress": 0,
#             "meta": f"失败: {e}"
#         })
#     finally:
#         db.close()
#
#
# # 批量更新line_order


# 处理音频文件，传入倍速，音量大小，以及line_id
@router.post("/process-audio/{line_id}")
async def process_audio(
    line_id: int,
    dto: LineAudioProcessDTO,
    line_service: LineService = Depends(get_line_service),
):
    res = line_service.process_audio(line_id, dto)
    if not res:
        return Res(data=None, code=400, message="处理失败")
    return Res(data=res, code=200, message="处理成功")


# 导出音频与字幕
@router.get("/export-audio/{chapter_id}")
async def export_audio(
    chapter_id: int,
    single: bool = Query(False, description="是否导出单条音频字幕"),
    line_service: LineService = Depends(get_line_service),
):
    res = line_service.export_audio(chapter_id, single)
    if not res:
        return Res(data=None, code=400, message="导出失败")
    return Res(data=res, code=200, message="导出成功")


# 生成单条音频的字幕（已经有音频）
#


# 矫正字幕
@router.post("/correct-subtitle/{chapter_id}")
async def correct_subtitle(
    chapter_id: int, line_service: LineService = Depends(get_line_service)
):
    # res = line_service.correct_subtitle(chapter_id)

    lines = line_service.get_all_lines(chapter_id)
    if not lines:
        print("无台词记录")
        return Res(data=None, code=400, message="无台词记录")
    paths = [line.audio_path for line in lines]
    if not paths or not paths[0]:
        print("未找到有效音频路径")
        return Res(data=None, code=400, message="未找到有效音频路径")
    # 读取所有台词，组成一个文本
    text = "\n".join([line.text_content for line in lines])
    output_dir_path = os.path.join(os.path.dirname(paths[0]), "result")
    output_subtitle_path = os.path.join(output_dir_path, "result.srt")
    if os.path.exists(output_subtitle_path):
        line_service.correct_subtitle(text, output_subtitle_path)
        print("整体字幕矫正完成")
    else:
        print("请先导出音频")
        return Res(data=None, code=400, message="请先导出音频")

    #         将单条字幕也进行矫正
    print("开始对单条字幕进行矫正")
    for line in lines:
        subtitle_path = line.subtitle_path
        line_text = line.text_content
        if (
            subtitle_path is not None
            and line_text is not None
            and os.path.exists(subtitle_path)
        ):
            line_service.correct_subtitle(line_text, subtitle_path)
            print(f"单条字幕矫正完成：{line.id}")
    return Res(data=None, code=200, message="生成成功")


# 单章节一键导出（音频 + 字幕）
@router.get("/export-chapter/{chapter_id}")
async def export_chapter_audio_with_subtitle(
    chapter_id: int,
    line_service: LineService = Depends(get_line_service),
    project_service: ProjectService = Depends(get_project_service),
    chapter_service: ChapterService = Depends(get_chapter_service),
):
    """
    单章节一键导出：合并音频为 MP3 + 生成 SRT/ASS 字幕。
    如果音频导出失败，则不导出字幕文件。
    """
    # 获取章节信息
    chapter = chapter_service.get_chapter(chapter_id)
    if not chapter:
        return Res(data=None, code=404, message="章节不存在")

    project = project_service.get_project(chapter.project_id)
    if not project:
        return Res(data=None, code=404, message="项目不存在")

    project_root_path = project.project_root_path or getConfigPath()

    result = line_service.export_chapter_audio_with_subtitle(
        chapter_id=chapter_id,
        project_root_path=project_root_path,
        project_id=chapter.project_id,
        chapter_title=chapter.title,
    )

    if not result["success"]:
        return Res(data=None, code=400, message=result["message"])

    return Res(data=result, code=200, message=result["message"])
