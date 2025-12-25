import logging
import hashlib
import secrets
import httpx
from datetime import datetime
from fastapi import APIRouter, HTTPException, status, Depends
import httpx
from bson import ObjectId
from ..db.mongodb import MongoDB, mongodb
from backend.models.user import UserCreate, UserResponse, UserLogin
from backend.models.responses import BaseResponse
from backend.auth.dependencies import require_auth
import os
from dotenv import load_dotenv
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter()
load_dotenv()

def hash_password(password: str, salt: str = None) -> tuple[str, str]:
    """Hash password with salt"""
    if salt is None:
        salt = secrets.token_hex(32)
    
    # Combine password and salt
    password_salt = f"{password}{salt}"
    
    # Hash using SHA-256
    password_hash = hashlib.sha256(password_salt.encode()).hexdigest()
    
    return password_hash, salt


def verify_password(password: str, password_hash: str, salt: str) -> bool:
    """Verify password against hash"""
    computed_hash, _ = hash_password(password, salt)
    return computed_hash == password_hash

OPENWEBUI_URL = os.getenv("OPENWEBUI_URL")  

async def create_webui_user(user: UserCreate):
    """
    Tạo user tương ứng bên Open-WebUI
    """
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{OPENWEBUI_URL}/api/v1/auths/signup",
                json={
                    "email": user.email,
                    "password": user.password,   # phải trùng để sau login
                    "name": user.student_name or user.username,
                    "profile_image_url": "/user.png"
                },
                timeout=10.0
            )
            if resp.status_code != 200:
                raise Exception(f"Open-WebUI signup failed: {resp.text}")
            return resp.json()
    except Exception as e:
        logger.error(f"Error syncing user to Open-WebUI: {str(e)}")
        return None

@router.post("/", response_model=BaseResponse[UserResponse])
async def create_user(user: UserCreate):
    """Create a new user"""
    
    # Check if username exists
    existing_user = await mongodb.db.users.find_one({"username": user.username})
    
    if existing_user:
        # User already exists, raise HTTP exception
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tên đăng nhập đã tồn tại"
        )
    # Check if email exists (only if email is provided)
    if user.email:
        existing_email = await mongodb.db.users.find_one({"email": user.email})
        if existing_email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email đã được sử dụng"
            )
    
    # Hash password
    password_hash, salt = hash_password(user.password)
    
    # Create new user
    now = datetime.utcnow()
    new_user = {
        "username": user.username,
        "password_hash": password_hash,
        "salt": salt,
        "role": user.role or "user",  # Thêm role với giá trị mặc định là "user"
        "created_at": now,
        "updated_at": now
    }
    
    # Add optional fields if provided
    if user.email:
        new_user["email"] = user.email
    
    if user.student_code:
        # Check if student_code already exists
        existing_student = await mongodb.db.users.find_one({"student_code": user.student_code})
        if existing_student:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Mã sinh viên đã tồn tại"
            )
        new_user["student_code"] = user.student_code
    
    if user.student_name:
        new_user["student_name"] = user.student_name
    
    if user.student_class:
        new_user["student_class"] = user.student_class
    
    try:
        # Insert into database
        result = await mongodb.db.users.insert_one(new_user)
        
        # Get created user
        created_user = await mongodb.db.users.find_one({"_id": result.inserted_id})
        # await create_webui_user(user)
        # Prepare response (exclude sensitive fields)
        response_data = UserResponse(
            _id=str(created_user["_id"]),
            username=created_user["username"],
            student_code=created_user.get("student_code"),
            student_name=created_user.get("student_name"),
            student_class=created_user.get("student_class"),
            role=created_user.get("role", "user"),
            email=created_user.get("email"),
            created_at=created_user["created_at"],
            updated_at=created_user["updated_at"]
        )
        
        return BaseResponse(
            statusCode=status.HTTP_201_CREATED,
            message="Đăng ký thành công",
            data=response_data
        )
    
    except Exception as e:
        logger.error(f"Error creating user: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Có lỗi xảy ra khi tạo tài khoản"
        )



@router.get("/{username}", response_model=BaseResponse[dict])
async def get_user(username: str):
    """Get user by username"""
    
    # Find user by username
    user = await mongodb.db.users.find_one({"username": username})
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy tên đăng nhập"
        )
    
    # Return user data including password_hash and salt for verification
    user_data = {
        "_id": str(user["_id"]),
        "username": user["username"],
        "student_code": user.get("student_code"),
        "student_name": user.get("student_name"),
        "student_class": user.get("student_class"),
        "password_hash": user.get("password_hash"),
        "salt": user.get("salt"),
        "created_at": user["created_at"],
        "updated_at": user["updated_at"]
    }
    
    return BaseResponse(
        statusCode=status.HTTP_200_OK,
        message="Lấy thông tin người dùng thành công",
        data=user_data
    )


@router.post("/login", response_model=BaseResponse[dict])
async def login_user(user_login: UserLogin):
    """Login user with username and password"""
    
    # Find user by username
    user = await mongodb.db.users.find_one({"username": user_login.username})
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Tên đăng nhập hoặc mật khẩu không đúng"
        )
    
    # Verify password
    if not verify_password(user_login.password, user["password_hash"], user["salt"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Tên đăng nhập hoặc mật khẩu không đúng"
        )
    
    # Update last login time
    now = datetime.utcnow()
    await mongodb.db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {"updated_at": now, "last_login": now}}
    )
    
    # Prepare response (same structure as get_user)
    user_data = {
        "_id": str(user["_id"]),
        "username": user["username"],
        "student_code": user.get("student_code"),
        "student_name": user.get("student_name"),
        "student_class": user.get("student_class"),
        "created_at": user["created_at"],
        "updated_at": now
    }
    
    return BaseResponse(
        statusCode=status.HTTP_200_OK,
        message="Đăng nhập thành công",
        data=user_data
    )


@router.get("/admin/all", response_model=BaseResponse)
async def get_all_users(current_user = Depends(require_auth)):
    """Get all users (admin only)"""
    # Kiểm tra quyền admin
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Chỉ admin mới có quyền xem danh sách người dùng"
        )
    print("Fetching all users for admin")
    # Lấy danh sách người dùng từ MongoDB
    users = await mongodb.db.users.find().to_list(length=None)
    
    # Lấy thông tin sử dụng token từ bảng rate_limits
    rate_limits = await mongodb.db.rate_limits.find().to_list(length=None)
    
    # Tạo dictionary ánh xạ user_id -> token usage
    token_usage = {
        rate_limit.get("user_id"): {
            "tokensToday": rate_limit.get("tokensToday", 0),
            "tokensThisMonth": rate_limit.get("tokensThisMonth", 0)
        } for rate_limit in rate_limits if "user_id" in rate_limit
    }
    
    # Chuẩn bị dữ liệu phản hồi
    user_list = []
    for user in users:
        user_id = str(user.get("_id"))
        user_tokens = token_usage.get(user_id, {"tokensToday": 0, "tokensThisMonth": 0})
        
        user_data = {
            "id": user_id,
            "username": user.get("username"),
            "studentCode": user.get("student_code", ""),
            "name": user.get("student_name", ""),
            "studentClass": user.get("student_class", ""),
            "role": user.get("role", "user"),
            "isActive": user.get("is_active", True),
            "lastLogin": user.get("last_login"),
            "createdAt": user.get("created_at"),
            "usedTokens": user_tokens.get("tokensThisMonth", 0),
            "maxTokens": user.get("max_tokens", 50000)
        }
        user_list.append(user_data)
    
    return BaseResponse(
        statusCode=status.HTTP_200_OK,
        message="Lấy danh sách người dùng thành công",
        data=user_list
    )


@router.put("/admin/{user_id}", response_model=BaseResponse)
async def update_user(
    user_id: str, 
    user_update: dict,
    current_user = Depends(require_auth)
):
    """Update user information (admin only)"""
    # Kiểm tra quyền admin
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Chỉ admin mới có quyền cập nhật thông tin người dùng"
        )
    
    try:
        # Convert user_id to ObjectId
        object_id = ObjectId(user_id)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ID người dùng không hợp lệ"
        )
    
    # Kiểm tra user tồn tại
    existing_user = await mongodb.db.users.find_one({"_id": object_id})
    if not existing_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy người dùng"
        )
    
    # Chuẩn bị dữ liệu cập nhật
    update_data = {}
    
    # Cập nhật các trường cơ bản
    if "studentCode" in user_update:
        update_data["student_code"] = user_update["studentCode"]
    
    if "name" in user_update:
        update_data["student_name"] = user_update["name"]
    
    if "studentClass" in user_update:
        update_data["student_class"] = user_update["studentClass"]
    
    if "role" in user_update:
        update_data["role"] = user_update["role"]
    
    if "isActive" in user_update:
        update_data["is_active"] = user_update["isActive"]
    
    if "maxTokens" in user_update:
        update_data["max_tokens"] = user_update["maxTokens"]
    
    # Cập nhật mật khẩu nếu được cung cấp
    if "password" in user_update and user_update["password"]:
        password_hash, salt = hash_password(user_update["password"])
        update_data["password_hash"] = password_hash
        update_data["salt"] = salt
    
    # Thêm thời gian cập nhật
    update_data["updated_at"] = datetime.utcnow()
    
    # Cập nhật vào cơ sở dữ liệu
    await mongodb.db.users.update_one(
        {"_id": object_id},
        {"$set": update_data}
    )
    
    return BaseResponse(
        statusCode=status.HTTP_200_OK,
        message="Cập nhật thông tin người dùng thành công",
        data={"id": user_id}
    )


@router.delete("/admin/{user_id}", response_model=BaseResponse)
async def delete_user(
    user_id: str,
    current_user = Depends(require_auth)
):
    """Delete a user (admin only)"""
    # Kiểm tra quyền admin
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Chỉ admin mới có quyền xóa người dùng"
        )
    
    try:
        # Convert user_id to ObjectId
        object_id = ObjectId(user_id)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ID người dùng không hợp lệ"
        )
    
    # Kiểm tra user tồn tại
    existing_user = await mongodb.db.users.find_one({"_id": object_id})
    if not existing_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy người dùng"
        )
    
    # Xóa người dùng
    await mongodb.db.users.delete_one({"_id": object_id})
    
    # Đồng thời xóa dữ liệu rate limit liên quan
    await mongodb.db.rate_limits.delete_one({"user_id": user_id})
    
    return BaseResponse(
        statusCode=status.HTTP_200_OK,
        message="Xóa người dùng thành công",
        data={"id": user_id}
    )