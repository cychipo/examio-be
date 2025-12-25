from datetime import datetime, timedelta
from typing import Optional, Dict, Any, Tuple
import os
from dotenv import load_dotenv

from jose import jwt, JWTError
from fastapi import Depends, HTTPException, status, Cookie, Request
from fastapi.security import OAuth2PasswordBearer
from pydantic import ValidationError

from backend.models.user import TokenData, UserResponse
from backend.db.mongodb import mongodb, MongoDB, get_db
from bson import ObjectId
# Tải biến môi trường
load_dotenv()
import logging
logger = logging.getLogger(__name__)
# JWT settings
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "your-secret-key-replace-in-production")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
JWT_ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("JWT_ACCESS_TOKEN_EXPIRE_MINUTES", "30"))
JWT_REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("JWT_REFRESH_TOKEN_EXPIRE_DAYS", "7"))

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

def create_token(data: Dict[str, Any], token_type: str = "access", expires_delta: Optional[timedelta] = None) -> str:
    """
    Tạo JWT token (access hoặc refresh)
    
    Args:
        data: Dữ liệu cần encode vào token
        token_type: Loại token ("access" hoặc "refresh")
        expires_delta: Thời gian hết hạn của token
        
    Returns:
        JWT token đã được encode
    """
    to_encode = data.copy()
    
    # Thêm loại token
    to_encode.update({"token_type": token_type})
    
    # Thiết lập thời gian hết hạn
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        if token_type == "access":
            expire = datetime.utcnow() + timedelta(minutes=JWT_ACCESS_TOKEN_EXPIRE_MINUTES)
        else:  # refresh token
            expire = datetime.utcnow() + timedelta(days=JWT_REFRESH_TOKEN_EXPIRE_DAYS)
    
    to_encode.update({"exp": expire})
    
    # Tạo JWT token
    encoded_jwt = jwt.encode(to_encode, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)
    return encoded_jwt

def create_access_token(data: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    """
    Tạo JWT access token
    
    Args:
        data: Dữ liệu cần encode vào token
        expires_delta: Thời gian hết hạn của token
        
    Returns:
        JWT token đã được encode
    """
    return create_token(data, "access", expires_delta)

def create_refresh_token(data: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    """
    Tạo JWT refresh token
    
    Args:
        data: Dữ liệu cần encode vào token
        expires_delta: Thời gian hết hạn của token
        
    Returns:
        JWT token đã được encode
    """
    return create_token(data, "refresh", expires_delta)

async def get_current_user(token: str = Depends(oauth2_scheme)) -> UserResponse:
    """
    Lấy thông tin người dùng hiện tại từ token
    
    Args:
        token: JWT token
        
    Returns:
        Thông tin người dùng
        
    Raises:
        HTTPException: Nếu token không hợp lệ hoặc người dùng không tồn tại
    """
    logger.info(f"🔍 Received token: {token[:20]}..." if token else "❌ No token received")
    
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Không thể xác thực thông tin đăng nhập",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        # Giải mã token
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        user_id: str = payload.get("sub")
        token_type: str = payload.get("token_type")
        
        if user_id is None:
            raise credentials_exception
        
        # Kiểm tra loại token
        if token_type != "access":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token không hợp lệ hoặc đã hết hạn",
                headers={"WWW-Authenticate": "Bearer"},
            )
        
        token_data = TokenData(user_id=user_id, token_type=token_type)
    except (JWTError, ValidationError):
        raise credentials_exception
    
    # Kiểm tra kết nối MongoDB
    print("abc")
    
    # Tìm kiếm người dùng trong database
    try:
        # Sử dụng hàm helper get_db để đảm bảo có kết nối
        db = await get_db()
        user = await db.users.find_one({"_id": ObjectId(token_data.user_id)})
        
        if user is None:
            raise credentials_exception
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Lỗi truy vấn cơ sở dữ liệu: {str(e)}",
        )
    
    if user is None:
        raise credentials_exception
    
    # Trả về dữ liệu dưới dạng dict thay vì UserResponse
    now = datetime.utcnow()
    user_data = {
        "_id": str(user["_id"]),
        "user_id": str(user["_id"]),  # Thêm trường user_id
        "username": user["username"],
        "student_code": user.get("student_code"),
        "student_name": user.get("student_name"),
        "student_class": user.get("student_class"),
        "role": user.get("role", "user"),  # Thêm trường role, mặc định là "user"
        "email": user.get("email"),
        "created_at": user["created_at"],
        "updated_at": user.get("updated_at", now)
    }
    
    return user_data

async def validate_refresh_token(refresh_token: str) -> str:
    """
    Xác thực refresh token và trả về user ID
    
    Args:
        refresh_token: Refresh token cần xác thực
        
    Returns:
        User ID từ token
        
    Raises:
        HTTPException: Nếu token không hợp lệ hoặc đã hết hạn
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Refresh token không hợp lệ hoặc đã hết hạn",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    try:
        # Giải mã token
        payload = jwt.decode(refresh_token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        user_id: str = payload.get("sub")
        token_type: str = payload.get("token_type")
        
        if user_id is None:
            raise credentials_exception
        
        # Kiểm tra loại token
        if token_type != "refresh":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token không phải là refresh token",
                headers={"WWW-Authenticate": "Bearer"},
            )
        
        # Kiểm tra xem người dùng có tồn tại không
        # Sử dụng hàm helper get_db để đảm bảo có kết nối
        try:
            db = await get_db()
            user = await db.users.find_one({"_id": ObjectId(user_id)})
            
            if user is None:
                raise credentials_exception
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Lỗi truy vấn cơ sở dữ liệu: {str(e)}",
            )
        
        # Vẫn trả về user_id cho các hàm hiện tại đang sử dụng
        return user_id
    except JWTError:
        raise credentials_exception
