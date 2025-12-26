from fastapi import APIRouter
from .chat import router as chat_router
from .file import router as file_router

# Create main router
router = APIRouter()

# Include sub-routers - AI Service only focuses on Chat and AI/OCR File operations
router.include_router(chat_router, prefix="/chat", tags=["chat"])
router.include_router(file_router, prefix="/ai", tags=["ai"])

__all__ = ["router"]
