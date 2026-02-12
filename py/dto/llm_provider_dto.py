import json
from datetime import datetime

from pydantic import BaseModel, Field as PydField, validator
from typing import Optional, Dict, Any, Union


class LLMProviderCreateDTO(BaseModel):
    """业务实体：LLM"""

    name: str
    id: Optional[int] = None
    api_base_url: Optional[str] = None
    api_key: Optional[str] = None
    model_list: Optional[str] = None
    status: Optional[int] = None

    # ✅ 默认自定义参数，允许接收 dict 或 str
    custom_params: Optional[Union[str, Dict[str, Any]]] = None

    @validator("custom_params", pre=True, always=True)
    def serialize_custom_params(cls, v):
        """确保 custom_params 始终为 JSON 字符串"""
        if isinstance(v, dict):
            return json.dumps(v, ensure_ascii=False)
        return v


class LLMProviderResponseDTO(BaseModel):
    """业务实体：LLM"""

    name: str
    id: Optional[int] = None
    api_base_url: Optional[str] = None
    api_key: Optional[str] = None
    model_list: Optional[str] = None
    status: Optional[int] = None
    updated_at: Optional[datetime] = None
    created_at: Optional[datetime] = None

    # ✅ 默认自定义参数
    custom_params: Optional[str] = None
