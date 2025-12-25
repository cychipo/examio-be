from datetime import timedelta, datetime
import os
import logging
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, HTTPException, status, Body
from fastapi.security import OAuth2PasswordRequestForm
import jwt
from fastapi.responses import JSONResponse
from ..db.mongodb import MongoDB, mongodb, get_db

# Khởi tạo logger
logger = logging.getLogger(__name__)
from backend.models.user import Token, UserResponse
from backend.models.responses import BaseResponse
from backend.auth.jwt import (
    create_access_token,
    create_refresh_token,
    get_current_user,
    validate_refresh_token
)
from backend.api.user import verify_password

# Tải biến môi trường
load_dotenv()

# JWT settings
JWT_ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("JWT_ACCESS_TOKEN_EXPIRE_MINUTES", "30"))
JWT_REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("JWT_REFRESH_TOKEN_EXPIRE_DAYS", "7"))

router = APIRouter()


@router.post("/login", response_model=BaseResponse[Token])
async def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends()):
    """
    Đăng nhập và lấy JWT token
    """
    # Tìm kiếm người dùng theo username
    try:
        # Sử dụng hàm helper get_db để đảm bảo có kết nối
        db = await get_db()
        user = await db.users.find_one({"username": form_data.username})
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Lỗi truy vấn cơ sở dữ liệu: {str(e)}",
        )
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Tên đăng nhập hoặc mật khẩu không đúng",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Kiểm tra password
    if not verify_password(form_data.password, user["password_hash"], user["salt"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Tên đăng nhập hoặc mật khẩu không đúng",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Tạo JWT token
    access_token_expires = timedelta(minutes=JWT_ACCESS_TOKEN_EXPIRE_MINUTES)
    refresh_token_expires = timedelta(days=JWT_REFRESH_TOKEN_EXPIRE_DAYS)
    
    access_token = create_access_token(
        data={"sub": str(user["_id"])},
        expires_delta=access_token_expires
    )
    
    refresh_token = create_refresh_token(
        data={"sub": str(user["_id"])},
        expires_delta=refresh_token_expires
    )
    
    # Cập nhật thời gian đăng nhập gần nhất
    now = datetime.utcnow()
    try:
        # Sử dụng hàm helper get_db để đảm bảo có kết nối
        db = await get_db()
        await db.users.update_one(
            {"_id": user["_id"]},
            {"$set": {"last_login": now, "updated_at": now}}
        )
    except Exception as e:
        # Log lỗi nhưng không làm gián đoạn quá trình đăng nhập
        logger.error(f"Không thể cập nhật thời gian đăng nhập: {str(e)}")
    
    return BaseResponse(
        statusCode=status.HTTP_200_OK,
        message="Đăng nhập thành công",
        data=Token(
            access_token=access_token,
            refresh_token=refresh_token,
            token_type="bearer"
        ),
         user= {
                "id": str(user["_id"]),
                "username": user["username"],
                "email": user.get("email"),
         }
    )




SECRET_KEY = os.getenv("SECRET_KEY")

@router.get("/generate_sso_token")
def generate_sso_token(user_id: str, email: str):
    payload = {
        "user_id": user_id,
        "email": email,
        "exp": datetime.utcnow() + timedelta(minutes=5)
    }
    token = jwt.encode(payload, SECRET_KEY, algorithm="HS256")
    if isinstance(token, bytes):  # tránh lỗi serialize
        token = token.decode("utf-8")
    return JSONResponse(content={"token": token})

@router.get("/me", response_model=BaseResponse)
async def get_current_user_info(current_user = Depends(get_current_user)):
    """
    Lấy thông tin người dùng hiện tại
    """
    # Trả về thông tin đầy đủ của người dùng
    return BaseResponse(
        statusCode=status.HTTP_200_OK,
        message="Lấy thông tin người dùng thành công",
        data=current_user
    )


@router.post("/refresh", response_model=BaseResponse[Token])
async def refresh_access_token(refresh_token: str = Body(..., embed=True)):
    """
    Làm mới token sử dụng refresh token
    
    Args:
        refresh_token: Refresh token
        
    Returns:
        Token mới bao gồm access token và refresh token
    """
    try:
        # Xác thực refresh token
        user_id = await validate_refresh_token(refresh_token)
        
        # Tạo token mới
        access_token_expires = timedelta(minutes=JWT_ACCESS_TOKEN_EXPIRE_MINUTES)
        refresh_token_expires = timedelta(days=JWT_REFRESH_TOKEN_EXPIRE_DAYS)
        
        access_token = create_access_token(
            data={"sub": user_id},
            expires_delta=access_token_expires
        )
        
        new_refresh_token = create_refresh_token(
            data={"sub": user_id},
            expires_delta=refresh_token_expires
        )
        
        return BaseResponse(
            statusCode=status.HTTP_200_OK,
            message="Token đã được làm mới thành công",
            data=Token(
                access_token=access_token,
                refresh_token=new_refresh_token,
                token_type="bearer"
            )
        )
    except HTTPException as e:
        raise e
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Không thể làm mới token: {str(e)}"
        )

@router.get("/db-status", response_model=BaseResponse)
async def check_db_status():
    """
    Kiểm tra trạng thái kết nối database
    """
    try:
        status_info = {
            "mongodb_instance": mongodb.db is not None,
            "mongodb_class": MongoDB.db is not None,
        }
        
        # Thử kết nối sử dụng get_db
        try:
            db = await get_db()
            collections = await db.list_collection_names()
            status_info["connected"] = True
            status_info["collections"] = collections
        except Exception as e:
            status_info["connected"] = False
            status_info["error"] = str(e)
        
        return BaseResponse(
            statusCode=status.HTTP_200_OK,
            message="Trạng thái kết nối database",
            data=status_info
        )
    except Exception as e:
        return BaseResponse(
            statusCode=status.HTTP_500_INTERNAL_SERVER_ERROR,
            message=f"Lỗi kiểm tra trạng thái database: {str(e)}",
            data=None
        )
