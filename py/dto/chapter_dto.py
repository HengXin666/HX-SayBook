from datetime import datetime

from pydantic import BaseModel
from typing import Optional, List


class ChapterCreateDTO(BaseModel):
    title: str
    project_id: int
    order_index: Optional[int] = None
    id: Optional[int] = None
    text_content: Optional[str] = None


class ChapterResponseDTO(BaseModel):
    title: str
    project_id: int
    order_index: Optional[int] = None
    id: Optional[int] = None
    text_content: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class ChapterBriefDTO(BaseModel):
    """轻量章节DTO，不含 text_content，用于列表展示"""

    id: Optional[int] = None
    title: str
    project_id: int
    order_index: Optional[int] = None
    has_content: bool = False  # 是否有文本内容
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class ChapterPageResponseDTO(BaseModel):
    """章节分页响应"""

    items: List[ChapterBriefDTO]
    total: int
    page: int
    page_size: int
