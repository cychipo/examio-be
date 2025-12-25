from typing import Generic, TypeVar, Optional

from pydantic import BaseModel

T = TypeVar('T')

class BaseResponse(BaseModel, Generic[T]):
    statusCode: int = 200
    message: str
    data: Optional[T] = None 