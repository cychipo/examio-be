"""
Content Generation Service - Generate Quiz and Flashcards from OCR'd content

This service uses LLM to generate educational content from document chunks.
"""
import json
import os
import asyncio
import logging
import re
import time
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
    MAX_SOURCE_CHUNKS = 8
    MAX_ITEMS_PER_CALL = 6
    DEFAULT_GENERATION_MAX_CONCURRENCY = 1

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    async def _get_pool(self) -> asyncpg.Pool:
        """Get or create connection pool"""
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

    def _get_generation_max_concurrency(self) -> int:
        raw = os.getenv("GENERATION_MAX_CONCURRENCY")
        if raw is None:
            return self.DEFAULT_GENERATION_MAX_CONCURRENCY
        try:
            value = int(raw)
            if value < 1:
                logger.warning(
                    f"GENERATION_MAX_CONCURRENCY must be >= 1, got {value}. Using {self.DEFAULT_GENERATION_MAX_CONCURRENCY}."
                )
                return self.DEFAULT_GENERATION_MAX_CONCURRENCY
            return value
        except ValueError:
            logger.warning(
                f"Invalid GENERATION_MAX_CONCURRENCY={raw!r}, using default={self.DEFAULT_GENERATION_MAX_CONCURRENCY}"
            )
            return self.DEFAULT_GENERATION_MAX_CONCURRENCY

    async def _generate_quiz_batch_for_chunk(
        self,
        chunk: DocumentChunk,
        chunk_position: int,
        total_chunks: int,
        batch_idx: int,
        num_batches: int,
        current_batch_size: int,
        final_model_enum: AIModelType,
    ) -> List[Dict[str, Any]]:
        logger.info(
            f"Processing chunk {chunk_position + 1}/{total_chunks}, "
            f"batch {batch_idx + 1}/{num_batches} (size: {current_batch_size})"
        )

        prompt = prompt_utils.generate_quiz_prompt(
            page_range=chunk.page_range,
            num_questions=current_batch_size,
            content=chunk.content
        )

        # Append strict JSON instruction to prompt
        json_prompt = prompt + "\n\nIMPORTANT: Return ONLY a raw JSON array. Do not wrap in markdown blocks. Do not add explanations."

        is_ollama = final_model_enum == AIModelType.FAYEDARK

        response = await model_manager.generate_content_with_model(
            json_prompt,
            final_model_enum,
            response_model=QuizList if is_ollama else None
        )

        if is_ollama:
            try:
                quiz_list = QuizList.model_validate_json(response)
                batch_results = [
                    self._normalize_quiz_item(item, chunk.page_range)
                    for item in quiz_list.items
                ]
            except Exception as e:
                logger.error(f"Failed to validate structured output (batch {batch_idx + 1}): {e}")
                batch_results = self._parse_quiz_response(response, chunk.page_range)
        else:
            batch_results = self._parse_quiz_response(response, chunk.page_range)

        if not batch_results:
            logger.warning(f"No questions generated for chunk {chunk_position + 1} batch {batch_idx + 1}")
            return []

        # Enforce batch size limit
        if len(batch_results) > current_batch_size:
            logger.warning(
                f"Batch returned more items than requested: {len(batch_results)} vs {current_batch_size}. Slicing."
            )
            batch_results = batch_results[:current_batch_size]

        return batch_results

    async def _generate_flashcard_batch_for_chunk(
        self,
        chunk: DocumentChunk,
        chunk_position: int,
        total_chunks: int,
        batch_idx: int,
        num_batches: int,
        current_batch_size: int,
        final_model_enum: AIModelType,
    ) -> List[Dict[str, Any]]:
        logger.info(
            f"Processing chunk {chunk_position + 1}/{total_chunks}, "
            f"batch {batch_idx + 1}/{num_batches} (size: {current_batch_size})"
        )

        prompt = prompt_utils.generate_flashcard_prompt(
            page_range=chunk.page_range,
            num_flashcards=current_batch_size,
            content=chunk.content
        )

        # Append strict JSON instruction to prompt
        json_prompt = prompt + "\n\nIMPORTANT: Return ONLY a raw JSON array. Do not wrap in markdown blocks. Do not add explanations."

        is_ollama = final_model_enum == AIModelType.FAYEDARK

        response = await model_manager.generate_content_with_model(
            json_prompt,
            final_model_enum,
            response_model=FlashcardList if is_ollama else None
        )

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
                logger.error(f"Failed to validate structured output for flashcards (batch {batch_idx + 1}): {e}")
                batch_results = self._parse_flashcard_response(response, chunk.page_range)
        else:
            batch_results = self._parse_flashcard_response(response, chunk.page_range)

        if not batch_results:
            logger.warning(f"No flashcards generated for chunk {chunk_position + 1} batch {batch_idx + 1}")
            return []

        # Enforce batch size limit
        if len(batch_results) > current_batch_size:
            logger.warning(
                f"Batch returned more items than requested: {len(batch_results)} vs {current_batch_size}. Slicing."
            )
            batch_results = batch_results[:current_batch_size]

        return batch_results

    async def _run_generation_tasks(
        self,
        tasks: List[Dict[str, Any]],
        max_concurrency: int,
        kind: str,
    ) -> List[Dict[str, Any]]:
        if not tasks:
            return []

        semaphore = asyncio.Semaphore(max(1, max_concurrency))

        async def _run_one(task: Dict[str, Any]) -> Dict[str, Any]:
            async with semaphore:
                try:
                    result = await task["runner"]()
                    return {
                        "chunk_index": task["chunk_index"],
                        "batch_index": task["batch_index"],
                        "items": result,
                        "error": None,
                    }
                except Exception as e:
                    import traceback
                    logger.error(
                        f"Error generating {kind} for chunk {task['chunk_index'] + 1} batch {task['batch_index'] + 1} | "
                        f"Error type: {type(e).__name__} | Error: {e}\n"
                        f"Traceback:\n{traceback.format_exc()}"
                    )
                    return {
                        "chunk_index": task["chunk_index"],
                        "batch_index": task["batch_index"],
                        "items": [],
                        "error": str(e),
                    }

        results = await asyncio.gather(*[_run_one(task) for task in tasks])
        results.sort(key=lambda item: (item["chunk_index"], item["batch_index"]))
        return results

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

            if file_info.processing_status not in ["COMPLETED", "PROCESSING"]:
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
            generation_start = time.perf_counter()

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

            original_chunk_count = len(chunks)
            chunks = self._select_chunks_for_generation(chunks, request.num_questions)
            selected_chunk_count = len(chunks)

            # Distribute questions across chunks
            questions_per_chunk = self._distribute_items(request.num_questions, selected_chunk_count)
            expected_batches = sum(
                (items + self.MAX_ITEMS_PER_CALL - 1) // self.MAX_ITEMS_PER_CALL
                for items in questions_per_chunk
                if items > 0
            )
            logger.info(
                f"[AI_TIMING] stage=quiz_prepare user_storage_id={request.user_storage_id} requested={request.num_questions} chunks_total={original_chunk_count} chunks_selected={selected_chunk_count} expected_batches={expected_batches} max_items_per_call={self.MAX_ITEMS_PER_CALL} model={model_type_str}"
            )

            generation_max_concurrency = self._get_generation_max_concurrency()
            logger.info(
                f"[AI_TIMING] stage=quiz_generation_config user_storage_id={request.user_storage_id} generation_max_concurrency={generation_max_concurrency}"
            )

            # Build chunk-batch tasks while preserving original selection/distribution logic
            generation_tasks = []
            for i, chunk in enumerate(chunks):
                if questions_per_chunk[i] == 0:
                    continue

                items_needed = questions_per_chunk[i]
                num_batches = (items_needed + self.MAX_ITEMS_PER_CALL - 1) // self.MAX_ITEMS_PER_CALL
                for batch_idx in range(num_batches):
                    current_batch_size = min(
                        self.MAX_ITEMS_PER_CALL,
                        items_needed - batch_idx * self.MAX_ITEMS_PER_CALL
                    )
                    generation_tasks.append({
                        "chunk_index": i,
                        "batch_index": batch_idx,
                        "runner": lambda c=chunk, ci=i, bi=batch_idx, nb=num_batches, bs=current_batch_size: self._generate_quiz_batch_for_chunk(
                            chunk=c,
                            chunk_position=ci,
                            total_chunks=len(chunks),
                            batch_idx=bi,
                            num_batches=nb,
                            current_batch_size=bs,
                            final_model_enum=final_model_enum,
                        )
                    })

            actual_batches = len(generation_tasks)
            generation_results = await self._run_generation_tasks(
                tasks=generation_tasks,
                max_concurrency=generation_max_concurrency,
                kind="quiz",
            )

            all_questions = []
            per_chunk_counts: Dict[int, int] = {}
            for result in generation_results:
                if result["items"]:
                    all_questions.extend(result["items"])
                    per_chunk_counts[result["chunk_index"]] = per_chunk_counts.get(result["chunk_index"], 0) + len(result["items"])

            for chunk_idx in sorted(per_chunk_counts.keys()):
                logger.info(f"Generated total {per_chunk_counts[chunk_idx]} questions for chunk {chunk_idx + 1}")

            if not all_questions:
                return {"success": False, "error": "Failed to generate any questions"}

            total_ms = int((time.perf_counter() - generation_start) * 1000)
            logger.info(
                f"[AI_TIMING] stage=quiz_total user_storage_id={request.user_storage_id} total_ms={total_ms} generated={len(all_questions)} actual_batches={actual_batches} expected_batches={expected_batches} chunks_used={selected_chunk_count}"
            )

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

            if file_info.processing_status not in ["COMPLETED", "PROCESSING"]:
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
            generation_start = time.perf_counter()

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

            original_chunk_count = len(chunks)
            chunks = self._select_chunks_for_generation(chunks, request.num_flashcards)
            selected_chunk_count = len(chunks)

            # Distribute flashcards across chunks
            flashcards_per_chunk = self._distribute_items(request.num_flashcards, selected_chunk_count)
            expected_batches = sum(
                (items + self.MAX_ITEMS_PER_CALL - 1) // self.MAX_ITEMS_PER_CALL
                for items in flashcards_per_chunk
                if items > 0
            )
            logger.info(
                f"[AI_TIMING] stage=flashcard_prepare user_storage_id={request.user_storage_id} requested={request.num_flashcards} chunks_total={original_chunk_count} chunks_selected={selected_chunk_count} expected_batches={expected_batches} max_items_per_call={self.MAX_ITEMS_PER_CALL} model={model_type_str}"
            )

            generation_max_concurrency = self._get_generation_max_concurrency()
            logger.info(
                f"[AI_TIMING] stage=flashcard_generation_config user_storage_id={request.user_storage_id} generation_max_concurrency={generation_max_concurrency}"
            )

            # Build chunk-batch tasks while preserving original selection/distribution logic
            generation_tasks = []
            for i, chunk in enumerate(chunks):
                if flashcards_per_chunk[i] == 0:
                    continue

                items_needed = flashcards_per_chunk[i]
                num_batches = (items_needed + self.MAX_ITEMS_PER_CALL - 1) // self.MAX_ITEMS_PER_CALL
                for batch_idx in range(num_batches):
                    current_batch_size = min(
                        self.MAX_ITEMS_PER_CALL,
                        items_needed - batch_idx * self.MAX_ITEMS_PER_CALL
                    )
                    generation_tasks.append({
                        "chunk_index": i,
                        "batch_index": batch_idx,
                        "runner": lambda c=chunk, ci=i, bi=batch_idx, nb=num_batches, bs=current_batch_size: self._generate_flashcard_batch_for_chunk(
                            chunk=c,
                            chunk_position=ci,
                            total_chunks=len(chunks),
                            batch_idx=bi,
                            num_batches=nb,
                            current_batch_size=bs,
                            final_model_enum=final_model_enum,
                        )
                    })

            actual_batches = len(generation_tasks)
            generation_results = await self._run_generation_tasks(
                tasks=generation_tasks,
                max_concurrency=generation_max_concurrency,
                kind="flashcards",
            )

            all_flashcards = []
            per_chunk_counts: Dict[int, int] = {}
            for result in generation_results:
                if result["items"]:
                    all_flashcards.extend(result["items"])
                    per_chunk_counts[result["chunk_index"]] = per_chunk_counts.get(result["chunk_index"], 0) + len(result["items"])

            for chunk_idx in sorted(per_chunk_counts.keys()):
                logger.info(f"Generated total {per_chunk_counts[chunk_idx]} flashcards for chunk {chunk_idx + 1}")

            if not all_flashcards:
                return {"success": False, "error": "Failed to generate any flashcards"}

            total_ms = int((time.perf_counter() - generation_start) * 1000)
            logger.info(
                f"[AI_TIMING] stage=flashcard_total user_storage_id={request.user_storage_id} total_ms={total_ms} generated={len(all_flashcards)} actual_batches={actual_batches} expected_batches={expected_batches} chunks_used={selected_chunk_count}"
            )

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

    def _select_chunks_for_generation(
        self,
        chunks: List[DocumentChunk],
        total_items: int
    ) -> List[DocumentChunk]:
        """Select bounded number of chunks to reduce generation latency."""
        if not chunks:
            return []

        needed_chunks = min(len(chunks), max(1, total_items), self.MAX_SOURCE_CHUNKS)

        if len(chunks) <= needed_chunks:
            return chunks

        # Keep chunk order stable but sample across the whole document
        step = len(chunks) / needed_chunks
        selected_indices = {min(len(chunks) - 1, int(i * step)) for i in range(needed_chunks)}
        selected_chunks = [chunk for idx, chunk in enumerate(chunks) if idx in selected_indices]

        if len(selected_chunks) < needed_chunks:
            for chunk in chunks:
                if chunk not in selected_chunks:
                    selected_chunks.append(chunk)
                    if len(selected_chunks) == needed_chunks:
                        break

        selected_chunks = selected_chunks[:needed_chunks]
        logger.info(
            f"Using {len(selected_chunks)}/{len(chunks)} chunks for generation (requested items: {total_items})"
        )
        return selected_chunks

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
