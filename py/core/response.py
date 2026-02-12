# py/core/response.py
from pydantic import BaseModel
from typing import Generic, TypeVar, Optional

T = TypeVar("T")


class Res(BaseModel, Generic[T]):
    """统一 API 响应格式"""

    code: int = 200
    message: str = "success"
    data: Optional[T] = None
