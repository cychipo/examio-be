"""
Content Generation API - Generate Quiz and Flashcards from files

Endpoints:
- POST /generate/quiz - Generate quiz questions from a processed file
- POST /generate/flashcards - Generate flashcards from a processed file
- GET /generate/quiz/:historyId - Get generated quiz by history ID
- GET /generate/flashcards/:historyId - Get generated flashcards by history ID
"""
import logging
from typing import Dict, Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.services.generation_service import (
    generation_service,
    GenerateQuizRequest,
    GenerateFlashcardRequest,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter()


# ==================== Request Models ====================

class GenerateQuizBody(BaseModel):
    """Request body for quiz generation"""
    user_storage_id: str = Field(..., alias="userStorageId", description="ID của UserStorage")
    user_id: str = Field(..., alias="userId", description="ID của user")
    num_questions: int = Field(default=10, alias="numQuestions", ge=1, le=50)

    class Config:
        populate_by_name = True


class GenerateFlashcardBody(BaseModel):
    """Request body for flashcard generation"""
    user_storage_id: str = Field(..., alias="userStorageId", description="ID của UserStorage")
    user_id: str = Field(..., alias="userId", description="ID của user")
    num_flashcards: int = Field(default=10, alias="numFlashcards", ge=1, le=50)

    class Config:
        populate_by_name = True


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
    logger.info(f"Generate quiz request: {body.user_storage_id}, {body.num_questions} questions")

    request = GenerateQuizRequest(
        user_storage_id=body.user_storage_id,
        user_id=body.user_id,
        num_questions=body.num_questions
    )

    result = await generation_service.generate_quiz(request)

    if not result.get("success"):
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
    logger.info(f"Generate flashcards request: {body.user_storage_id}, {body.num_flashcards} flashcards")

    request = GenerateFlashcardRequest(
        user_storage_id=body.user_storage_id,
        user_id=body.user_id,
        num_flashcards=body.num_flashcards
    )

    result = await generation_service.generate_flashcards(request)

    if not result.get("success"):
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
