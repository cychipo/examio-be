"""
Content Generation API - Generate Quiz and Flashcards from files

Endpoints:
- POST /generate/quiz - Generate quiz questions from a processed file
- POST /generate/flashcards - Generate flashcards from a processed file
- GET /generate/quiz/:historyId - Get generated quiz by history ID
- GET /generate/flashcards/:historyId - Get generated flashcards by history ID
"""
import logging
from typing import Dict, Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from src.backend.services.generation_service import (
    generation_service,
    GenerateQuizRequest,
    GenerateFlashcardRequest,
)
from src.llm.model_manager import ModelUnavailableError

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter()


# ==================== Request Models ====================

class GenerateQuizBody(BaseModel):
    """Request body for quiz generation"""
    userStorageId: str = Field(..., description="ID của UserStorage")
    userId: str = Field(..., description="ID của user")
    numQuestions: int = Field(default=10, ge=1, le=100)
    isNarrowSearch: bool = Field(default=False, description="Chế độ tìm kiếm hẹp")
    keyword: Optional[str] = Field(default=None, description="Từ khóa cho tìm kiếm hẹp")
    modelType: str = Field(
        default='qwen3_8b',
        description='Model id tu registry'
    )


class GenerateFlashcardBody(BaseModel):
    """Request body for flashcard generation"""
    userStorageId: str = Field(..., description="ID của UserStorage")
    userId: str = Field(..., description="ID của user")
    numFlashcards: int = Field(default=10, ge=1, le=100)
    isNarrowSearch: bool = Field(default=False, description="Chế độ tìm kiếm hẹp")
    keyword: Optional[str] = Field(default=None, description="Từ khóa cho tìm kiếm hẹp")
    modelType: str = Field(
        default='qwen3_8b',
        description='Model id tu registry'
    )


# ==================== API Endpoints ====================

@router.post("/quiz", response_model=Dict[str, Any])
async def generate_quiz(body: GenerateQuizBody):
    """
    Generate quiz questions from a processed file

    Flow:
    1. Client uploads file via NestJS → UserStorage created with PENDING
    2. OCR processing completes → status = COMPLETED
    3. Client calls this endpoint with userStorageId
    4. AI generates quiz questions from document chunks
    5. Returns generated questions and saves to HistoryGeneratedQuizz

    Returns:
    - success: bool
    - history_id: ID of HistoryGeneratedQuizz record
    - quizzes: array of generated questions
    - count: number of questions generated
    """
    logger.info(f"Generate quiz request: {body.userStorageId}, {body.numQuestions} questions, model: {body.modelType}")

    request = GenerateQuizRequest(
        user_storage_id=body.userStorageId,
        user_id=body.userId,
        num_questions=body.numQuestions,
        is_narrow_search=body.isNarrowSearch,
        keyword=body.keyword,
        model_type=body.modelType
    )

    try:
        result = await generation_service.generate_quiz(request)
    except ModelUnavailableError as error:
        raise HTTPException(
            status_code=503,
            detail={"code": error.code, "message": str(error)},
        )

    if not result.get("success"):
        if result.get('error_code') in {
            'MODEL_UNAVAILABLE',
            'MODEL_INSUFFICIENT_VRAM',
            'MODEL_RUNTIME_ERROR',
        }:
            raise HTTPException(
                status_code=result.get('status_code', 503),
                detail={
                    'code': result.get('error_code'),
                    'message': result.get('error', 'Model unavailable'),
                },
            )
        raise HTTPException(
            status_code=400,
            detail=result.get("error", "Failed to generate quiz")
        )

    return result


@router.post("/flashcards", response_model=Dict[str, Any])
async def generate_flashcards(body: GenerateFlashcardBody):
    """
    Generate flashcards from a processed file

    Flow:
    1. Client uploads file via NestJS → UserStorage created with PENDING
    2. OCR processing completes → status = COMPLETED
    3. Client calls this endpoint with userStorageId
    4. AI generates flashcards from document chunks
    5. Returns generated flashcards and saves to HistoryGeneratedFlashcard

    Returns:
    - success: bool
    - history_id: ID of HistoryGeneratedFlashcard record
    - flashcards: array of generated flashcards
    - count: number of flashcards generated
    """
    logger.info(f"Generate flashcards request: {body.userStorageId}, {body.numFlashcards} flashcards, model: {body.modelType}")

    request = GenerateFlashcardRequest(
        user_storage_id=body.userStorageId,
        user_id=body.userId,
        num_flashcards=body.numFlashcards,
        is_narrow_search=body.isNarrowSearch,
        keyword=body.keyword,
        model_type=body.modelType
    )

    try:
        result = await generation_service.generate_flashcards(request)
    except ModelUnavailableError as error:
        raise HTTPException(
            status_code=503,
            detail={"code": error.code, "message": str(error)},
        )

    if not result.get("success"):
        if result.get('error_code') in {
            'MODEL_UNAVAILABLE',
            'MODEL_INSUFFICIENT_VRAM',
            'MODEL_RUNTIME_ERROR',
        }:
            raise HTTPException(
                status_code=result.get('status_code', 503),
                detail={
                    'code': result.get('error_code'),
                    'message': result.get('error', 'Model unavailable'),
                },
            )
        raise HTTPException(
            status_code=400,
            detail=result.get("error", "Failed to generate flashcards")
        )

    return result


@router.get("/quiz/{history_id}", response_model=Dict[str, Any])
async def get_quiz_history(history_id: str):
    """
    Get generated quiz by history ID

    Returns the saved quiz questions from HistoryGeneratedQuizz table
    """
    result = await generation_service.get_quiz_history(history_id)

    if not result:
        raise HTTPException(
            status_code=404,
            detail="Quiz history not found"
        )

    return {
        "success": True,
        **result
    }


@router.get("/flashcards/{history_id}", response_model=Dict[str, Any])
async def get_flashcard_history(history_id: str):
    """
    Get generated flashcards by history ID

    Returns the saved flashcards from HistoryGeneratedFlashcard table
    """
    result = await generation_service.get_flashcard_history(history_id)

    if not result:
        raise HTTPException(
            status_code=404,
            detail="Flashcard history not found"
        )

    return {
        "success": True,
        **result
    }
