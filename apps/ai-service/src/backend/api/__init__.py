from fastapi import APIRouter
from .chat import router as chat_router
from .file import router as file_router
from .user import router as user_router
from .auth import router as auth_router
from .rate_limit import router as rate_limit_router
from .models import router as models_router
from .admin_rag import router as admin_rag_router
from .admin_model import router as admin_model_router

# Create main router
router = APIRouter()

# Include sub-routers
router.include_router(chat_router, prefix="/chat", tags=["chat"])
router.include_router(file_router, prefix="/chat", tags=["file"])
router.include_router(user_router, prefix="/users", tags=["users"])
router.include_router(auth_router, prefix="/auth", tags=["auth"])
router.include_router(rate_limit_router, prefix="", tags=["rate_limit"])
router.include_router(models_router, prefix="/models", tags=["models"])
router.include_router(admin_rag_router, prefix="/admin/rag", tags=["admin_rag"])
router.include_router(admin_model_router, prefix="/admin/models", tags=["admin_models"])

__all__ = ["router"]