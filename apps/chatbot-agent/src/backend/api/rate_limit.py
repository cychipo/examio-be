from fastapi import APIRouter, Depends, HTTPException, status
from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta
from pydantic import BaseModel
from bson import ObjectId
import logging

from backend.auth.dependencies import require_auth
from backend.models.responses import BaseResponse
from backend.db.mongodb import mongodb
from backend.models.rate_limit import RateLimitStat

logger = logging.getLogger(__name__)

router = APIRouter()

# Models for rate limiting
class RateLimitSettings(BaseModel):
    enabled: bool = True
    requestsPerMinute: int
    requestsPerHour: int
    requestsPerDay: int
    tokensPerDay: int
    tokensPerMonth: int

class RoleLimits(BaseModel):
    admin: RateLimitSettings
    user: RateLimitSettings

class UserException(BaseModel):
    username: str
    requestsPerMinute: int
    requestsPerHour: int
    requestsPerDay: int
    tokensPerDay: int
    tokensPerMonth: int

class RateLimitConfig(BaseModel):
    enabled: bool = True
    defaultLimits: RateLimitSettings
    roleLimits: RoleLimits
    userExceptions: List[UserException] = []

@router.get("/rate-limits", response_model=BaseResponse[RateLimitConfig])
async def get_rate_limit_config(current_user = Depends(require_auth)):
    """
    Lấy cấu hình giới hạn tốc độ
    """
    # Kiểm tra quyền admin
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Chỉ admin mới có quyền xem cấu hình giới hạn tốc độ"
        )
    
    # Tìm cấu hình trong database, nếu không có thì trả về cấu hình mặc định
    config = await mongodb.db.settings.find_one({"type": "rate_limit"})
    
    if not config:
        # Cấu hình mặc định
        default_config = RateLimitConfig(
            enabled=True,
            defaultLimits=RateLimitSettings(
                requestsPerMinute=10,
                requestsPerHour=100,
                requestsPerDay=500,
                tokensPerDay=50000,
                tokensPerMonth=500000
            ),
            roleLimits=RoleLimits(
                admin=RateLimitSettings(
                    requestsPerMinute=30,
                    requestsPerHour=300,
                    requestsPerDay=1000,
                    tokensPerDay=200000,
                    tokensPerMonth=2000000
                ),
                user=RateLimitSettings(
                    requestsPerMinute=10,
                    requestsPerHour=100,
                    requestsPerDay=500,
                    tokensPerDay=50000,
                    tokensPerMonth=500000
                )
            ),
            userExceptions=[]
        )
        return BaseResponse(
            statusCode=status.HTTP_200_OK,
            message="Cấu hình giới hạn tốc độ mặc định",
            data=default_config
        )
    
    return BaseResponse(
        statusCode=status.HTTP_200_OK,
        message="Cấu hình giới hạn tốc độ",
        data=config["settings"]
    )

@router.post("/rate-limits", response_model=BaseResponse)
@router.put("/rate-limits", response_model=BaseResponse)
async def update_rate_limit_config(
    config: RateLimitConfig,
    current_user = Depends(require_auth)
):
    """
    Cập nhật cấu hình giới hạn tốc độ
    """
    # Kiểm tra quyền admin
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Chỉ admin mới có quyền cập nhật cấu hình giới hạn tốc độ"
        )
    
    # Cập nhật cấu hình
    await mongodb.db.settings.update_one(
        {"type": "rate_limit"},
        {"$set": {"settings": config.dict(), "updated_at": datetime.utcnow()}},
        upsert=True
    )
    
    return BaseResponse(
        statusCode=status.HTTP_200_OK,
        message="Cập nhật cấu hình giới hạn tốc độ thành công"
    )

@router.delete("/admin/rate-limits/user/{user_id}", response_model=BaseResponse)
async def reset_user_rate_limit(
    user_id: str,
    current_user = Depends(require_auth)
):
    """
    Reset giới hạn tốc độ của một người dùng cụ thể (chỉ dành cho admin)
    """
    # Kiểm tra quyền admin
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Chỉ admin mới có quyền reset giới hạn tốc độ"
        )
    
    # Kiểm tra người dùng tồn tại
    user = await mongodb.db.users.find_one({"_id": user_id})
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Người dùng không tồn tại"
        )
    
    # Xóa rate limit của người dùng
    result = await mongodb.db.rate_limits.delete_one({"user_id": user_id})
    
    if result.deleted_count == 0:
        return BaseResponse(
            statusCode=status.HTTP_200_OK,
            message=f"Không tìm thấy dữ liệu rate limit của người dùng {user.get('username')}"
        )
    
    return BaseResponse(
        statusCode=status.HTTP_200_OK,
        message=f"Đã reset giới hạn tốc độ của người dùng {user.get('username')}"
    )

@router.get("/stats/user/rate-limits", response_model=BaseResponse)
async def get_user_rate_limit_stats(current_user = Depends(require_auth)):
    """
    Lấy thống kê về giới hạn tốc độ của người dùng hiện tại (endpoint cho frontend)
    """
    # Re-use the existing stats function logic
    return await get_rate_limit_stats(current_user)

@router.get("/admin/rate-limits/stats", response_model=BaseResponse)
async def get_all_rate_limit_stats(current_user = Depends(require_auth)):
    """
    Lấy thống kê về giới hạn tốc độ của tất cả người dùng (chỉ dành cho admin)
    """
    # Kiểm tra quyền admin
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Chỉ admin mới có quyền xem thống kê giới hạn tốc độ của tất cả người dùng"
        )
    
    # Lấy thống kê từ MongoDB
    rate_limit_stats = await mongodb.db.rate_limits.find().to_list(length=100)
    
    # Lấy cấu hình rate limit
    config = await mongodb.db.settings.find_one({"type": "rate_limit"})
    
    if not config:
        return BaseResponse(
            statusCode=status.HTTP_200_OK,
            message="Thống kê giới hạn tốc độ của tất cả người dùng",
            data={
                "stats": rate_limit_stats,
                "config": "Chưa thiết lập giới hạn"
            }
        )
    
    return BaseResponse(
        statusCode=status.HTTP_200_OK,
        message="Thống kê giới hạn tốc độ của tất cả người dùng",
        data={
            "stats": rate_limit_stats,
            "config": config["settings"]
        }
    )

@router.get("/admin/rate-limits/usage-summary", response_model=BaseResponse)
async def get_rate_limit_usage_summary(current_user = Depends(require_auth)):
    """
    Lấy tổng hợp thống kê sử dụng (chỉ dành cho admin)
    """
    # Kiểm tra quyền admin
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Chỉ admin mới có quyền xem tổng hợp thống kê sử dụng"
        )
    
    # Lấy thống kê từ MongoDB
    rate_limit_stats = await mongodb.db.rate_limits.find().to_list(length=None)
    
    # Tính tổng các chỉ số
    total_requests_today = sum(stat.get("requestsPerDay", 0) for stat in rate_limit_stats)
    total_tokens_today = sum(stat.get("tokensToday", 0) for stat in rate_limit_stats)
    total_tokens_month = sum(stat.get("tokensThisMonth", 0) for stat in rate_limit_stats)
    
    # Tìm người dùng sử dụng nhiều nhất
    most_active_users = sorted(
        rate_limit_stats, 
        key=lambda x: x.get("requestsPerDay", 0), 
        reverse=True
    )[:5]
    
    most_token_users = sorted(
        rate_limit_stats, 
        key=lambda x: x.get("tokensThisMonth", 0), 
        reverse=True
    )[:5]
    
    # Đếm số người dùng đã sử dụng hệ thống
    active_users_count = len(rate_limit_stats)
    
    return BaseResponse(
        statusCode=status.HTTP_200_OK,
        message="Tổng hợp thống kê sử dụng",
        data={
            "totalRequestsToday": total_requests_today,
            "totalTokensToday": total_tokens_today,
            "totalTokensThisMonth": total_tokens_month,
            "activeUsersCount": active_users_count,
            "mostActiveUsers": [
                {
                    "username": user.get("username"),
                    "requestsToday": user.get("requestsPerDay", 0),
                    "tokensToday": user.get("tokensToday", 0)
                } for user in most_active_users
            ],
            "mostTokenUsers": [
                {
                    "username": user.get("username"),
                    "tokensThisMonth": user.get("tokensThisMonth", 0)
                } for user in most_token_users
            ]
        }
    )

@router.get("/rate-limits/stats", response_model=BaseResponse)
async def get_rate_limit_stats(current_user = Depends(require_auth)):
    """
    Lấy thống kê về giới hạn tốc độ
    """
    user_id = str(current_user.get("_id"))
    username = current_user.get("username")
    
    # Tìm request counts của user từ MongoDB
    user_rate_limit = await mongodb.db.rate_limits.find_one({"user_id": user_id})
    
    now = datetime.utcnow()
    if not user_rate_limit:
        # Tạo mới thống kê nếu chưa có
        user_stats = {
            "requestsPerMinute": 0,
            "requestsPerHour": 0,
            "requestsPerDay": 0,
            "tokensToday": 0,
            "tokensThisMonth": 0,
            "resetTimes": {
                "minute": now + timedelta(minutes=1),
                "hour": now + timedelta(hours=1),
                "day": now + timedelta(days=1),
                "month": now.replace(day=1, hour=0, minute=0, second=0, microsecond=0) + timedelta(days=32)
            }
        }
    else:
        # Chuyển đổi resetTimes từ chuỗi sang datetime
        reset_times = {}
        for key, value in user_rate_limit.get("resetTimes", {}).items():
            if isinstance(value, str):
                reset_times[key] = datetime.fromisoformat(value)
            else:
                reset_times[key] = value
                
        user_stats = {
            "requestsPerMinute": user_rate_limit.get("requestsPerMinute", 0),
            "requestsPerHour": user_rate_limit.get("requestsPerHour", 0),
            "requestsPerDay": user_rate_limit.get("requestsPerDay", 0),
            "tokensToday": user_rate_limit.get("tokensToday", 0),
            "tokensThisMonth": user_rate_limit.get("tokensThisMonth", 0),
            "resetTimes": reset_times
        }
    
    # Lấy cấu hình rate limit
    config = await mongodb.db.settings.find_one({"type": "rate_limit"})
    if not config:
        return BaseResponse(
            statusCode=status.HTTP_200_OK,
            message="Thống kê giới hạn tốc độ",
            data={
                "usage": user_stats,
                "limits": "Chưa thiết lập giới hạn"
            }
        )
    
    # Xác định limit dựa trên role và exception
    limits = None
    settings = config["settings"]
    
    # Kiểm tra user exception
    for exception in settings.get("userExceptions", []):
        if exception.get("username") == username:
            limits = {
                "requestsPerMinute": exception.get("requestsPerMinute"),
                "requestsPerHour": exception.get("requestsPerHour"),
                "requestsPerDay": exception.get("requestsPerDay"),
                "tokensPerDay": exception.get("tokensPerDay"),
                "tokensPerMonth": exception.get("tokensPerMonth")
            }
            break
    
    # Nếu không có exception, dùng role limit
    if limits is None:
        role = current_user.get("role", "user")
        role_limits = settings.get("roleLimits", {}).get(role)
        if role_limits:
            limits = {
                "requestsPerMinute": role_limits.get("requestsPerMinute"),
                "requestsPerHour": role_limits.get("requestsPerHour"),
                "requestsPerDay": role_limits.get("requestsPerDay"),
                "tokensPerDay": role_limits.get("tokensPerDay"),
                "tokensPerMonth": role_limits.get("tokensPerMonth")
            }
        else:
            # Fallback to default limits
            default_limits = settings.get("defaultLimits", {})
            limits = {
                "requestsPerMinute": default_limits.get("requestsPerMinute", 10),
                "requestsPerHour": default_limits.get("requestsPerHour", 100),
                "requestsPerDay": default_limits.get("requestsPerDay", 500),
                "tokensPerDay": default_limits.get("tokensPerDay", 50000),
                "tokensPerMonth": default_limits.get("tokensPerMonth", 500000)
            }
    
    return BaseResponse(
        statusCode=status.HTTP_200_OK,
        message="Thống kê giới hạn tốc độ",
        data={
            "usage": user_stats,
            "limits": limits,
            "enabled": settings.get("enabled", True)
        }
    )

# Middleware function to check rate limit
async def check_rate_limit(user_id: str, token_count: int = 0, count_as_request: bool = True):
    """
    Kiểm tra giới hạn tốc độ của người dùng
    
    Args:
        user_id: ID của người dùng
        token_count: Số token sử dụng (nếu có)
        count_as_request: Có tính là một request hay không (mỗi cặp câu hỏi-trả lời là 1 request)
        
    Returns:
        (allowed, message): (True, None) nếu được phép, (False, error_message) nếu vượt quá giới hạn
    """
    # Lấy cấu hình rate limit
    config = await mongodb.db.settings.find_one({"type": "rate_limit"})
    
    # Nếu không có cấu hình hoặc rate limit bị tắt
    if not config or not config.get("settings", {}).get("enabled", True):
        return True, None
    
    # Lấy thông tin người dùng
    try:
        # Chuyển đổi user_id thành ObjectId nếu có thể
        if ObjectId.is_valid(user_id):
            user_id_obj = ObjectId(user_id)
            user = await mongodb.db.users.find_one({"_id": user_id_obj})
        else:
            # Nếu không thể chuyển đổi, thử tìm kiếm theo chuỗi
            user = await mongodb.db.users.find_one({"_id": user_id})
        
        if not user:
            return False, "Người dùng không tồn tại"
        
        username = user.get("username")
        role = user.get("role", "user")
    except Exception as e:
        logger.error(f"Lỗi khi tìm kiếm người dùng: {str(e)}")
        return False, f"Lỗi khi kiểm tra giới hạn tốc độ: {str(e)}"
    
    # Xác định limit dựa trên role và exception
    limits = None
    settings = config["settings"]
    
    # Kiểm tra user exception
    for exception in settings.get("userExceptions", []):
        if exception.get("username") == username:
            limits = {
                "requestsPerMinute": exception.get("requestsPerMinute"),
                "requestsPerHour": exception.get("requestsPerHour"),
                "requestsPerDay": exception.get("requestsPerDay"),
                "tokensPerDay": exception.get("tokensPerDay"),
                "tokensPerMonth": exception.get("tokensPerMonth")
            }
            break
    
    # Nếu không có exception, dùng role limit
    if limits is None:
        role_limits = settings.get("roleLimits", {}).get(role)
        if role_limits:
            limits = {
                "requestsPerMinute": role_limits.get("requestsPerMinute"),
                "requestsPerHour": role_limits.get("requestsPerHour"),
                "requestsPerDay": role_limits.get("requestsPerDay"),
                "tokensPerDay": role_limits.get("tokensPerDay"),
                "tokensPerMonth": role_limits.get("tokensPerMonth")
            }
        else:
            # Fallback to default limits
            default_limits = settings.get("defaultLimits", {})
            limits = {
                "requestsPerMinute": default_limits.get("requestsPerMinute", 10),
                "requestsPerHour": default_limits.get("requestsPerHour", 100),
                "requestsPerDay": default_limits.get("requestsPerDay", 500),
                "tokensPerDay": default_limits.get("tokensPerDay", 50000),
                "tokensPerMonth": default_limits.get("tokensPerMonth", 500000)
            }
    logger.info(f"Rate limits for user {username}: {limits}")
    # Cập nhật counts và kiểm tra giới hạn
    now = datetime.utcnow()
    
    # Sử dụng user_id_obj cho truy vấn MongoDB nếu đã chuyển đổi
    user_id_for_query = user_id_obj if 'user_id_obj' in locals() else user_id
    
    # Lấy thông tin rate limit từ MongoDB
    rate_limit_data = await mongodb.db.rate_limits.find_one({"user_id": user_id_for_query})
    
    if not rate_limit_data:
        # Tạo mới nếu chưa có
        stats = {
            "user_id": user_id_for_query,
            "username": username,
            "requestsPerMinute": 0,
            "requestsPerHour": 0, 
            "requestsPerDay": 0,
            "tokensToday": 0,
            "tokensThisMonth": 0,
            "resetTimes": {
                "minute": now + timedelta(minutes=1),
                "hour": now + timedelta(hours=1),
                "day": now + timedelta(days=1),
                "month": now.replace(day=1, hour=0, minute=0, second=0, microsecond=0) + timedelta(days=32)
            },
            "lastUpdated": now
        }
    else:
        # Chuyển đổi resetTimes từ chuỗi sang datetime nếu cần
        reset_times = {}
        for key, value in rate_limit_data.get("resetTimes", {}).items():
            if isinstance(value, str):
                reset_times[key] = datetime.fromisoformat(value)
            else:
                reset_times[key] = value
        
        stats = rate_limit_data
        stats["resetTimes"] = reset_times
    
    # Reset counters nếu cần
    if now >= stats["resetTimes"]["minute"]:
        stats["requestsPerMinute"] = 0
        stats["resetTimes"]["minute"] = now + timedelta(minutes=1)
    
    if now >= stats["resetTimes"]["hour"]:
        stats["requestsPerHour"] = 0
        stats["resetTimes"]["hour"] = now + timedelta(hours=1)
    
    if now >= stats["resetTimes"]["day"]:
        stats["requestsPerDay"] = 0
        stats["tokensToday"] = 0
        stats["resetTimes"]["day"] = now + timedelta(days=1)
    
    if now >= stats["resetTimes"]["month"]:
        stats["tokensThisMonth"] = 0
        next_month = now.replace(day=1) + timedelta(days=32)
        stats["resetTimes"]["month"] = next_month.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    
    # Cập nhật counters
    if count_as_request:
        stats["requestsPerMinute"] += 1
        stats["requestsPerHour"] += 1
        stats["requestsPerDay"] += 1
    
    # Token counters always get updated
    stats["tokensToday"] += token_count
    stats["tokensThisMonth"] += token_count
    stats["lastUpdated"] = now
    
    # Lưu vào MongoDB (upsert = True để tạo mới nếu chưa có)
    await mongodb.db.rate_limits.update_one(
        {"user_id": user_id_for_query},
        {"$set": stats},
        upsert=True
    )
    
    # Kiểm tra giới hạn
    if stats["requestsPerMinute"] > limits["requestsPerMinute"]:
        return False, f"Vượt quá giới hạn yêu cầu mỗi phút ({limits['requestsPerMinute']})"
    
    if stats["requestsPerHour"] > limits["requestsPerHour"]:
        return False, f"Vượt quá giới hạn yêu cầu mỗi giờ ({limits['requestsPerHour']})"
    
    if stats["requestsPerDay"] > limits["requestsPerDay"]:
        return False, f"Vượt quá giới hạn yêu cầu mỗi ngày ({limits['requestsPerDay']})"
    
    if stats["tokensToday"] > limits["tokensPerDay"]:
        return False, f"Vượt quá giới hạn token mỗi ngày ({limits['tokensPerDay']})"
    
    if stats["tokensThisMonth"] > limits["tokensPerMonth"]:
        return False, f"Vượt quá giới hạn token mỗi tháng ({limits['tokensPerMonth']})"
    
    return True, None
