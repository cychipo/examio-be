from fastapi import Depends, HTTPException, status
from backend.auth.jwt import get_current_user
from backend.models.user import UserResponse

def require_auth(current_user = Depends(get_current_user)):
    """
    Middleware để yêu cầu xác thực cho các endpoint được bảo vệ
    
    Args:
        current_user: Người dùng hiện tại từ token (có thể là UserResponse hoặc dict)
        
    Returns:
        Thông tin người dùng nếu đã xác thực
        
    Raises:
        HTTPException: Nếu người dùng không được xác thực
    """
    print("Checking authentication...")
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Vui lòng đăng nhập để sử dụng tính năng này",
            headers={"WWW-Authenticate": "Bearer"},
        )
    print(f"Authenticated user")
    return current_user

def get_current_admin_user(current_user = Depends(get_current_user)):
    """
    Dependency để yêu cầu quyền admin
    
    Args:
        current_user: Người dùng hiện tại từ token
        
    Returns:
        Thông tin người dùng admin nếu đã xác thực và có quyền admin
        
    Raises:
        HTTPException: Nếu người dùng không phải admin
    """
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Không thể xác thực thông tin đăng nhập",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Kiểm tra role admin
    user_role = current_user.get("role", "user") if isinstance(current_user, dict) else getattr(current_user, "role", "user")
    
    if user_role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bạn không có quyền truy cập tính năng này. Chỉ admin mới được phép.",
        )
    
    return current_user
