"""
Content Generation Service - Generate Quiz and Flashcards from OCR'd content

This service uses LLM to generate educational content from document chunks.
"""
import json
import logging
import re
import uuid
from typing import List, Dict, Any, Optional
from datetime import datetime
from dataclasses import dataclass

import asyncpg
from pydantic import BaseModel, Field

from src.backend.utils.prompt_utils import prompt_utils
from src.backend.services.ocr_service import ocr_service, DocumentChunk
from src.llm.model_manager import model_manager, AIModelType
from src.rag.vector_store_pg import get_pg_vector_store

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ==================== Schema Definitions ====================

class QuizItem(BaseModel):
    question: str = Field(description="The quiz question text")
    options: List[str] = Field(description="A list of 4 possible answers")
    answer: str = Field(description="The correct answer matching one of the options exactly")
    sourcePageRange: Optional[str] = Field(default=None, description="The source page range reference")

class QuizList(BaseModel):
    items: List[QuizItem] = Field(description="List of quiz questions")

class FlashcardItem(BaseModel):
    question: str = Field(description="The front of the flashcard (concept or question)")
    answer: str = Field(description="The back of the flashcard (definition or answer)")
    sourcePageRange: Optional[str] = Field(default=None, description="The source page range reference")

class FlashcardList(BaseModel):
    items: List[FlashcardItem] = Field(description="List of flashcards")



# ==================== Request/Response Models ====================

class GenerateQuizRequest(BaseModel):
    """Request to generate quiz from file"""
    user_storage_id: str = Field(..., description="ID của UserStorage")
    user_id: str = Field(..., description="ID của user")
    num_questions: int = Field(default=10, ge=1, le=100, description="Số câu hỏi cần tạo (max 100)")
    is_narrow_search: bool = Field(default=False, description="Chế độ tìm kiếm hẹp")
    keyword: Optional[str] = Field(None, description="Từ khóa cho tìm kiếm hẹp")
    model_type: Optional[str] = Field(default=None, description="AI model: 'gemini' or 'fayedark'")


class GenerateFlashcardRequest(BaseModel):
    """Request to generate flashcards from file"""
    user_storage_id: str = Field(..., description="ID của UserStorage")
    user_id: str = Field(..., description="ID của user")
    num_flashcards: int = Field(default=10, ge=1, le=100, description="Số flashcard cần tạo (max 100)")
    is_narrow_search: bool = Field(default=False, description="Chế độ tìm kiếm hẹp")
    keyword: Optional[str] = Field(None, description="Từ khóa cho tìm kiếm hẹp")
    model_type: Optional[str] = Field(default=None, description="AI model: 'gemini' or 'fayedark'")


@dataclass
class QuizQuestion:
    """Generated quiz question"""
    question: str
    options: List[str]
    answer: str
    source_page_range: str


@dataclass
class Flashcard:
    """Generated flashcard"""
    question: str
    answer: str
    source_page_range: str


class ContentGenerationService:
    """Service for generating quiz and flashcard content using LLM"""

    _instance = None
    _pool: Optional[asyncpg.Pool] = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    async def _get_pool(self) -> asyncpg.Pool:
        """Get or create connection pool"""
        import os
        if self._pool is None or self._pool._closed:
            postgres_uri = os.environ.get("DATABASE_URL")
            if not postgres_uri:
                raise ValueError("DATABASE_URL environment variable not set")

            self._pool = await asyncpg.create_pool(
                postgres_uri,
                min_size=2,
                max_size=10,
                command_timeout=60
            )
            logger.info("PostgreSQL connection pool created for ContentGenerationService")

        return self._pool

    async def generate_quiz(
        self,
        request: GenerateQuizRequest
    ) -> Dict[str, Any]:
        """
        Generate quiz questions from a processed file

        Returns dict with:
        - success: bool
        - history_id: str (ID of HistoryGeneratedQuizz)
        - quizzes: list of generated questions
        - error: str (if failed)
        """
        try:
            # Check if file is processed
            file_info = await ocr_service.get_file_info(request.user_storage_id)
            if not file_info:
                return {"success": False, "error": "File not found"}

            if file_info.processing_status != "COMPLETED":
                return {"success": False, "error": f"File not processed yet. Status: {file_info.processing_status}"}

            # Determine AI model type strictly based on user request first
            from src.llm.model_manager import model_manager, ModelType
            
            # Default to System Setting if request is empty
            final_model_enum = AIModelType.GEMINI 
            
            if request.model_type:
                if request.model_type.lower() == "gemini":
                    final_model_enum = AIModelType.GEMINI
                elif request.model_type.lower() in ["fayedark", "ollama", "local"]:
                    final_model_enum = AIModelType.FAYEDARK
            else:
                # Fallback to system env if not specified
                system_type = model_manager.get_model_type()
                if system_type == ModelType.OLLAMA:
                    final_model_enum = AIModelType.FAYEDARK
                else:
                    final_model_enum = AIModelType.GEMINI
            
            logger.info(f"Using AI model for quiz: {final_model_enum.value} (Request: {request.model_type})")
            model_type_str = "fayedark" if final_model_enum == AIModelType.FAYEDARK else "gemini"

            # Get document chunks
            chunks = []
            if request.is_narrow_search and request.keyword:
                logger.info(f"Generating with Narrow Search for keyword: {request.keyword}")
                vector_store = get_pg_vector_store()
                embedding = await vector_store.create_embedding(request.keyword, model_type=model_type_str)

                # Search similar chunks (limit 10 for focused context)
                similar_results = await ocr_service.search_similar_documents(
                    [request.user_storage_id],
                    embedding,
                    limit=10,
                    similarity_threshold=0.5
                )
                chunks = [res[0] for res in similar_results]

                if not chunks:
                    logger.warning("Narrow search returned no results, falling back to full content")
                    chunks = await ocr_service.get_document_chunks(request.user_storage_id)
            else:
                chunks = await ocr_service.get_document_chunks(request.user_storage_id)

            if not chunks:
                return {"success": False, "error": "No content found in file"}

            # Distribute questions across chunks
            questions_per_chunk = self._distribute_items(request.num_questions, len(chunks))

            # Generate questions from each chunk
            all_questions = []
            for i, chunk in enumerate(chunks):
                if questions_per_chunk[i] == 0:
                    continue

                # Batching logic to avoid timeouts (max 3 items per request)
                items_needed = questions_per_chunk[i]
                BATCH_SIZE = 3
                
                chunk_questions = []
                
                # Calculate number of batches needed
                num_batches = (items_needed + BATCH_SIZE - 1) // BATCH_SIZE
                
                for batch_idx in range(num_batches):
                    # Calculate questions for this batch
                    current_batch_size = min(BATCH_SIZE, items_needed - batch_idx * BATCH_SIZE)
                    
                    logger.info(f"Processing chunk {i+1}/{len(chunks)}, batch {batch_idx+1}/{num_batches} (size: {current_batch_size})")

                    prompt = prompt_utils.generate_quiz_prompt(
                        page_range=chunk.page_range,
                        num_questions=current_batch_size,
                        content=chunk.content
                    )

                    # Append strict JSON instruction to prompt
                    json_prompt = prompt + "\n\nIMPORTANT: Return ONLY a raw JSON array. Do not wrap in markdown blocks. Do not add explanations."
                    
                    is_ollama = final_model_enum == AIModelType.FAYEDARK
                    
                    try:
                        response = await model_manager.generate_content_with_model(
                            json_prompt, 
                            final_model_enum,
                            response_model=QuizList if is_ollama else None
                        )
                        
                        batch_results = []
                        if is_ollama:
                            try:
                                # Parse structured output from Ollama
                                quiz_list = QuizList.model_validate_json(response)
                                batch_results = [
                                    self._normalize_quiz_item(item, chunk.page_range)
                                    for item in quiz_list.items
                                ]
                            except Exception as e:
                                logger.error(f"Failed to validate structured output (batch {batch_idx+1}): {e}")
                                # Fallback to manual parsing
                                batch_results = self._parse_quiz_response(response, chunk.page_range)
                        else:
                            batch_results = self._parse_quiz_response(response, chunk.page_range)

                        if batch_results:
                            # Enforce batch size limit
                            if len(batch_results) > current_batch_size:
                                logger.warning(f"Batch returned more items than requested: {len(batch_results)} vs {current_batch_size}. Slicing.")
                                batch_results = batch_results[:current_batch_size]
                                
                            chunk_questions.extend(batch_results)
                        else:
                            logger.warning(f"No questions generated for chunk {i+1} batch {batch_idx+1}")
                    except Exception as e:
                        logger.error(f"Generation failed for chunk {i+1} batch {batch_idx+1}: {e}")
                        continue
                
                if chunk_questions:
                    logger.info(f"Generated total {len(chunk_questions)} questions for chunk {i+1}")
                    all_questions.extend(chunk_questions)

            if not all_questions:
                return {"success": False, "error": "Failed to generate any questions"}

            # Save to HistoryGeneratedQuizz
            try:
                history_id = await self._save_quiz_history(
                    user_id=request.user_id,
                    user_storage_id=request.user_storage_id,
                    quizzes=all_questions
                )

                return {
                    "success": True,
                    "history_id": history_id,
                    "quizzes": all_questions,
                    "count": len(all_questions)
                }
            except Exception as e:
                logger.error(f"Failed to save quiz history: {e}")
                if "violates foreign key constraint" in str(e):
                    return {"success": False, "error": "Job cancelled or UserStorage not found"}
                raise e

        except Exception as e:
            logger.exception(f"Error generating quiz: {e}")
            return {"success": False, "error": str(e)}

    async def generate_flashcards(
        self,
        request: GenerateFlashcardRequest
    ) -> Dict[str, Any]:
        """
        Generate flashcards from a processed file

        Returns dict with:
        - success: bool
        - history_id: str (ID of HistoryGeneratedFlashcard)
        - flashcards: list of generated flashcards
        - error: str (if failed)
        """
        try:
            # Check if file is processed
            file_info = await ocr_service.get_file_info(request.user_storage_id)
            if not file_info:
                return {"success": False, "error": "File not found"}

            if file_info.processing_status != "COMPLETED":
                return {"success": False, "error": f"File not processed yet. Status: {file_info.processing_status}"}

            # Determine AI model type strictly based on user request first
            from src.llm.model_manager import model_manager, ModelType
            
            # Default to System Setting if request is empty
            final_model_enum = AIModelType.GEMINI
            
            if request.model_type:
                if request.model_type.lower() == "gemini":
                    final_model_enum = AIModelType.GEMINI
                elif request.model_type.lower() in ["fayedark", "ollama", "local"]:
                    final_model_enum = AIModelType.FAYEDARK
            else:
                # Fallback to system env if not specified
                system_type = model_manager.get_model_type()
                if system_type == ModelType.OLLAMA:
                    final_model_enum = AIModelType.FAYEDARK
                else:
                    final_model_enum = AIModelType.GEMINI
            
            logger.info(f"Using AI model for flashcards: {final_model_enum.value} (Request: {request.model_type})")
            model_type_str = "fayedark" if final_model_enum == AIModelType.FAYEDARK else "gemini"

            # Get document chunks
            chunks = []
            if request.is_narrow_search and request.keyword:
                logger.info(f"Generating with Narrow Search for keyword: {request.keyword}")
                vector_store = get_pg_vector_store()
                embedding = await vector_store.create_embedding(request.keyword, model_type=model_type_str)

                # Search similar chunks (limit 10 for focused context)
                similar_results = await ocr_service.search_similar_documents(
                    [request.user_storage_id],
                    embedding,
                    limit=10,
                    similarity_threshold=0.5
                )
                chunks = [res[0] for res in similar_results]

                if not chunks:
                    logger.warning("Narrow search returned no results, falling back to full content")
                    chunks = await ocr_service.get_document_chunks(request.user_storage_id)
            else:
                chunks = await ocr_service.get_document_chunks(request.user_storage_id)

            if not chunks:
                return {"success": False, "error": "No content found in file"}

            # Distribute flashcards across chunks
            flashcards_per_chunk = self._distribute_items(request.num_flashcards, len(chunks))

            # Generate flashcards from each chunk
            all_flashcards = []
            for i, chunk in enumerate(chunks):
                if flashcards_per_chunk[i] == 0:
                    continue

                # Batching logic to avoid timeouts (max 3 items per request)
                items_needed = flashcards_per_chunk[i]
                BATCH_SIZE = 3
                
                chunk_flashcards = []
                
                # Calculate number of batches needed
                num_batches = (items_needed + BATCH_SIZE - 1) // BATCH_SIZE
                
                for batch_idx in range(num_batches):
                    # Calculate flashcards for this batch
                    current_batch_size = min(BATCH_SIZE, items_needed - batch_idx * BATCH_SIZE)
                    
                    logger.info(f"Processing chunk {i+1}/{len(chunks)}, batch {batch_idx+1}/{num_batches} (size: {current_batch_size})")

                    prompt = prompt_utils.generate_flashcard_prompt(
                        page_range=chunk.page_range,
                        num_flashcards=current_batch_size,
                        content=chunk.content
                    )

                    # Append strict JSON instruction to prompt
                    json_prompt = prompt + "\n\nIMPORTANT: Return ONLY a raw JSON array. Do not wrap in markdown blocks. Do not add explanations."
                    
                    is_ollama = final_model_enum == AIModelType.FAYEDARK
                    
                    try:
                        response = await model_manager.generate_content_with_model(
                            json_prompt, 
                            final_model_enum, 
                            response_model=FlashcardList if is_ollama else None
                        )
                        
                        batch_results = []
                        if is_ollama:
                            try:
                                fc_list = FlashcardList.model_validate_json(response)
                                batch_results = [
                                    {
                                        "question": item.question,
                                        "answer": item.answer,
                                        "sourcePageRange": item.sourcePageRange or chunk.page_range
                                    }
                                    for item in fc_list.items
                                ]
                            except Exception as e:
                                logger.error(f"Failed to validate structured output for flashcards (batch {batch_idx+1}): {e}")
                                batch_results = self._parse_flashcard_response(response, chunk.page_range)
                        else:
                            batch_results = self._parse_flashcard_response(response, chunk.page_range)

                        if batch_results:
                            # Enforce batch size limit
                            if len(batch_results) > current_batch_size:
                                logger.warning(f"Batch returned more items than requested: {len(batch_results)} vs {current_batch_size}. Slicing.")
                                batch_results = batch_results[:current_batch_size]
                                
                            chunk_flashcards.extend(batch_results)
                        else:
                            logger.warning(f"No flashcards generated for chunk {i+1} batch {batch_idx+1}")
                            
                    except Exception as chunk_error:
                        logger.error(f"Error generating flashcards for chunk {i+1} batch {batch_idx+1}: {chunk_error}")
                        continue
                
                if chunk_flashcards:
                    logger.info(f"Generated total {len(chunk_flashcards)} flashcards for chunk {i+1}")
                    all_flashcards.extend(chunk_flashcards)

            if not all_flashcards:
                return {"success": False, "error": "Failed to generate any flashcards"}

            # Save to HistoryGeneratedFlashcard
            try:
                history_id = await self._save_flashcard_history(
                    user_id=request.user_id,
                    user_storage_id=request.user_storage_id,
                    flashcards=all_flashcards
                )

                return {
                    "success": True,
                    "history_id": history_id,
                    "flashcards": all_flashcards,
                    "count": len(all_flashcards)
                }
            except Exception as e:
                logger.error(f"Failed to save flashcard history: {e}")
                if "violates foreign key constraint" in str(e):
                    return {"success": False, "error": "Job cancelled or UserStorage not found"}
                raise e

        except Exception as e:
            logger.exception(f"Error generating flashcards: {e}")
            return {"success": False, "error": str(e)}

    def _distribute_items(self, total: int, num_chunks: int) -> List[int]:
        """Distribute items evenly across chunks"""
        if num_chunks == 0:
            return []

        base = total // num_chunks
        remainder = total % num_chunks

        distribution = [base] * num_chunks
        for i in range(remainder):
            distribution[i] += 1

        return distribution

    def _parse_quiz_response(self, response: str, default_page_range: str) -> List[Dict]:
        """Parse LLM response into quiz questions"""
        try:
            # Try to extract JSON from response
            json_str = self._extract_json(response)
            questions = json.loads(json_str)

            result = []
            for q in questions:
                result.append({
                    "question": q.get("question", ""),
                    "options": q.get("options", []),
                    "answer": q.get("answer", ""),
                    "sourcePageRange": q.get("sourcePageRange", default_page_range)
                })
            return result

        except Exception as e:
            logger.error(f"Failed to parse quiz response: {e}")
            return []

    def _parse_flashcard_response(self, response: str, default_page_range: str) -> List[Dict]:
        """Parse LLM response into flashcards"""
        try:
            # Try to extract JSON from response
            json_str = self._extract_json(response)
            flashcards = json.loads(json_str)

            result = []
            for f in flashcards:
                result.append({
                    "question": f.get("question", ""),
                    "answer": f.get("answer", ""),
                    "sourcePageRange": f.get("sourcePageRange", default_page_range)
                })
            return result

        except Exception as e:
            logger.error(f"Failed to parse flashcard response: {e}")
            return []

    def _extract_json(self, text: str) -> str:
        """Extract JSON array from text (handle markdown code blocks and flexible finding)"""
        # 1. Try to find markdown block first
        json_block_match = re.search(r'```(?:json)?\s*(\[[\s\S]*?\])\s*```', text)
        if json_block_match:
            return json_block_match.group(1)

        # 2. Try to find the first outer bracket pair [...]
        # This regex looks for [ ... ] where ... can contain nested brackets but imperfectly
        # For simplicity and speed, we look for the first '[' and the last ']'
        start_idx = text.find('[')
        end_idx = text.rfind(']')

        if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
            return text[start_idx : end_idx + 1]

        raise ValueError("No JSON array found in response")

    def _normalize_quiz_item(self, item: QuizItem, page_range: str) -> dict:
        """Normalize quiz item to ensure correct format"""
        valid_answers = ["A", "B", "C", "D"]
        clean_answer = str(item.answer).strip()

        # Normalize Options first
        new_options = []
        for idx, opt in enumerate(item.options):
            prefix = f"{valid_answers[idx]}. "
            clean_opt = str(opt).strip()
            # Remove existing prefixes like "A. ", "A) ", "1. ", etc.
            # Using simple replacement for common patterns to avoid complex regex logic if possible, 
            # but regex is safer for "A) content".
            import re
            # Matches A., A), 1., 1), or just A space at start
            clean_opt = re.sub(r'^([A-D]|[0-9]+)[\.\)\:]\s+', '', clean_opt)
            # Remove literal "A " if present
            if clean_opt.startswith(valid_answers[idx] + " "):
                clean_opt = clean_opt[2:].strip()
                
            new_options.append(f"{prefix}{clean_opt}")
            
        # Fix Answer if it is not A/B/C/D (e.g. full text answer)
        if clean_answer not in valid_answers:
            # Try to match with options
            found = False
            
            # 1. Check normalized new_options
            for idx, opt in enumerate(new_options): 
                # opt is "A. content". We check content.
                opt_content = opt[3:].strip() 
                if clean_answer.lower() == opt_content.lower() or clean_answer in opt_content:
                    clean_answer = valid_answers[idx]
                    found = True
                    break
            
            if not found:
                # 2. Check original item.options
                 for idx, opt in enumerate(item.options):
                    if clean_answer in str(opt):
                        clean_answer = valid_answers[idx]
                        found = True
                        break
            
            if not found:
                 # 3. Last resort: if answer looks like "A) content", extract A
                 if len(clean_answer) > 0 and clean_answer[0].upper() in valid_answers:
                     clean_answer = clean_answer[0].upper()
                 else:
                     logger.warning(f"Could not normalize answer '{item.answer}', defaulting to A")
                     clean_answer = "A"

        return {
            "question": item.question,
            "options": new_options,
            "answer": clean_answer,
            "sourcePageRange": item.sourcePageRange or page_range
        }

    async def _save_quiz_history(
        self,
        user_id: str,
        user_storage_id: str,
        quizzes: List[Dict]
    ) -> str:
        """Save generated quizzes to HistoryGeneratedQuizz table"""
        pool = await self._get_pool()
        history_id = str(uuid.uuid4()).replace("-", "")[:25]  # cuid-like

        query = """
            INSERT INTO "HistoryGeneratedQuizz" (id, "userId", "userStorageId", quizzes, "createdAt", "updatedAt")
            VALUES ($1, $2, $3, $4, NOW(), NOW())
            RETURNING id
        """

        async with pool.acquire() as conn:
            await conn.execute(
                query,
                history_id,
                user_id,
                user_storage_id,
                json.dumps(quizzes)
            )

        logger.info(f"Saved quiz history {history_id} with {len(quizzes)} questions")
        return history_id

    async def _save_flashcard_history(
        self,
        user_id: str,
        user_storage_id: str,
        flashcards: List[Dict]
    ) -> str:
        """Save generated flashcards to HistoryGeneratedFlashcard table"""
        pool = await self._get_pool()
        history_id = str(uuid.uuid4()).replace("-", "")[:25]  # cuid-like

        query = """
            INSERT INTO "HistoryGeneratedFlashcard" (id, "userId", "userStorageId", flashcards, "createdAt", "updatedAt")
            VALUES ($1, $2, $3, $4, NOW(), NOW())
            RETURNING id
        """

        async with pool.acquire() as conn:
            await conn.execute(
                query,
                history_id,
                user_id,
                user_storage_id,
                json.dumps(flashcards)
            )

        logger.info(f"Saved flashcard history {history_id} with {len(flashcards)} flashcards")
        return history_id

    async def get_quiz_history(self, history_id: str) -> Optional[Dict]:
        """Get quiz history by ID"""
        pool = await self._get_pool()

        query = """
            SELECT id, "userId", "userStorageId", quizzes, "createdAt"
            FROM "HistoryGeneratedQuizz"
            WHERE id = $1
        """

        async with pool.acquire() as conn:
            row = await conn.fetchrow(query, history_id)
            if row:
                return {
                    "id": row["id"],
                    "userId": row["userId"],
                    "userStorageId": row["userStorageId"],
                    "quizzes": json.loads(row["quizzes"]) if isinstance(row["quizzes"], str) else row["quizzes"],
                    "createdAt": row["createdAt"].isoformat()
                }
        return None

    async def get_flashcard_history(self, history_id: str) -> Optional[Dict]:
        """Get flashcard history by ID"""
        pool = await self._get_pool()

        query = """
            SELECT id, "userId", "userStorageId", flashcards, "createdAt"
            FROM "HistoryGeneratedFlashcard"
            WHERE id = $1
        """

        async with pool.acquire() as conn:
            row = await conn.fetchrow(query, history_id)
            if row:
                return {
                    "id": row["id"],
                    "userId": row["userId"],
                    "userStorageId": row["userStorageId"],
                    "flashcards": json.loads(row["flashcards"]) if isinstance(row["flashcards"], str) else row["flashcards"],
                    "createdAt": row["createdAt"].isoformat()
                }
        return None


# Singleton instance
generation_service = ContentGenerationService()
