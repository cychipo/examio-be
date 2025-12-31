from fastapi import APIRouter
from .chat import router as chat_router
from .file import router as file_router
from .generation import router as generation_router

# Create main router
router = APIRouter()

# Include sub-routers - AI Service focuses on Chat, OCR File operations, and Content Generation
router.include_router(chat_router, prefix="/chat", tags=["chat"])
router.include_router(file_router, prefix="/ai", tags=["ai"])
router.include_router(generation_router, prefix="/generate", tags=["generation"])

__all__ = ["router"]
