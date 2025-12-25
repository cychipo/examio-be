from pydantic import BaseModel, Field,EmailStr
from typing import Optional
from datetime import datetime


class UserCreate(BaseModel):
    username: str
    password: str  # Raw password (sẽ được hash)
    student_code: Optional[str] = None
    student_name: Optional[str] = None
    student_class: Optional[str] = None
    role: Optional[str] = "user"  # Thêm role, mặc định là "user"
    email: Optional[EmailStr] = None  # Email là optional


class UserLogin(BaseModel):
    username: str
    password: str


class UserResponse(BaseModel):
    _id: str
    username: str
    student_code: Optional[str] = None
    student_name: Optional[str] = None
    student_class: Optional[str] = None
    role: Optional[str] = "user"  # Thêm role, mặc định là "user"
    email: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    # Không trả về password_hash và salt trong response 


class Token(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str


class TokenData(BaseModel):
    user_id: str
    token_type: Optional[str] = "access"  # "access" hoặc "refresh"