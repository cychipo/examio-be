from datetime import datetime
from typing import Dict, Any, Optional
from pydantic import BaseModel

class RateLimitStat(BaseModel):
    """
    Mô hình dữ liệu cho thống kê giới hạn tốc độ của người dùng
    """
    user_id: str
    username: str
    requestsPerMinute: int = 0
    requestsPerHour: int = 0  
    requestsPerDay: int = 0
    tokensToday: int = 0
    tokensThisMonth: int = 0
    resetTimes: Dict[str, datetime] = {}
    lastUpdated: datetime = datetime.utcnow()
    
    @classmethod
    def create_new(cls, user_id: str, username: str) -> 'RateLimitStat':
        """
        Tạo một đối tượng RateLimitStat mới với các giá trị mặc định
        """
        now = datetime.utcnow()
        
        next_month = now.replace(day=1)
        import calendar
        days_in_month = calendar.monthrange(next_month.year, next_month.month)[1]
        next_month = next_month.replace(day=days_in_month)
        
        return cls(
            user_id=user_id,
            username=username,
            requestsPerMinute=0,
            requestsPerHour=0,
            requestsPerDay=0,
            tokensToday=0,
            tokensThisMonth=0,
            resetTimes={
                "minute": now.replace(second=0, microsecond=0).replace(minute=now.minute+1),
                "hour": now.replace(minute=0, second=0, microsecond=0).replace(hour=now.hour+1),
                "day": now.replace(hour=0, minute=0, second=0, microsecond=0).replace(day=now.day+1),
                "month": next_month.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            },
            lastUpdated=now
        )
