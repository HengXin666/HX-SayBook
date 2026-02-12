from datetime import datetime

from pydantic import BaseModel
from typing import Optional, List


class ProjectCreateDTO(BaseModel):
    name: str
    description: Optional[str] = None
    llm_provider_id: Optional[int] = None
    llm_model: Optional[str] = None
    tts_provider_id: Optional[int] = None
    prompt_id: Optional[int] = None
    # 精准填充
    is_precise_fill: Optional[int] = None
    # 项目路径
    project_root_path: Optional[str] = None
    # 路人语音池
    passerby_voice_pool: Optional[List[int]] = None


class ProjectResponseDTO(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    llm_provider_id: Optional[int] = None
    llm_model: Optional[str] = None
    tts_provider_id: Optional[int] = None
    prompt_id: Optional[int] = None
    # 精准填充
    is_precise_fill: Optional[int] = None
    # 项目路径
    project_root_path: Optional[str] = None
    # 路人语音池
    passerby_voice_pool: Optional[List[int]] = None
    created_at: datetime
    updated_at: datetime


class ProjectImportDTO(BaseModel):
    id: int
    content: str
