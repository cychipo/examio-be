"""
OCR Processing Service - Xử lý OCR và embeddings cho files

Service này CHỈ xử lý AI tasks:
1. Nhận file info từ NestJS (userStorageId + R2 URL)
2. Download file từ R2
3. OCR và chunk content
4. Tạo embeddings và lưu vào Document table
5. Update processingStatus

KHÔNG xử lý: Upload file, tạo UserStorage record (NestJS làm)
"""

import os
import logging
import tempfile
import httpx
from typing import Optional, List, Tuple, Any, Dict
from datetime import datetime
from dataclasses import dataclass

import asyncpg
from langchain_text_splitters import RecursiveCharacterTextSplitter

from src.llm.ollama_embeddings import get_embedding_text_limit

logger = logging.getLogger(__name__)

DEFAULT_OCR_TEXT_CHUNK_OVERLAP = 200


class FileExtractionError(Exception):
    """Raised when a file cannot be parsed into text."""


class NoContentExtractedError(Exception):
    """Raised when OCR/text extraction returns no usable content."""


def _get_int_env(name: str, default: int, min_value: int = 1) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default

    try:
        value = int(raw)
        return max(min_value, value)
    except ValueError:
        logger.warning(f"Invalid {name}={raw!r}, using default={default}")
        return default


def _resolve_text_splitter_config() -> tuple[int, int, int]:
    embed_limit = get_embedding_text_limit()
    configured_chunk_size = _get_int_env("OCR_TEXT_CHUNK_SIZE", embed_limit)
    chunk_size = min(configured_chunk_size, embed_limit)

    default_overlap = min(DEFAULT_OCR_TEXT_CHUNK_OVERLAP, max(0, chunk_size - 1))
    configured_overlap = _get_int_env("OCR_TEXT_CHUNK_OVERLAP", default_overlap, min_value=0)
    chunk_overlap = min(configured_overlap, max(0, chunk_size - 1))

    if configured_chunk_size > chunk_size:
        logger.info(
            f"OCR_TEXT_CHUNK_SIZE={configured_chunk_size} exceeds OLLAMA_EMBED_MAX_LENGTH={embed_limit}; using chunk_size={chunk_size}"
        )
    if configured_overlap != chunk_overlap:
        logger.info(
            f"OCR_TEXT_CHUNK_OVERLAP={configured_overlap} exceeds allowed range for chunk_size={chunk_size}; using chunk_overlap={chunk_overlap}"
        )

    return chunk_size, chunk_overlap, embed_limit


@dataclass
class FileInfo:
    """File info from UserStorage (created by NestJS)"""
    id: str
    user_id: str
    filename: str
    url: str  # R2 public URL
    mimetype: str
    processing_status: str


@dataclass
class DocumentChunk:
    """Document chunk with embedding"""
    id: str
    user_storage_id: str
    page_range: str
    title: Optional[str]
    content: str
    created_at: datetime


class OCRProcessingService:
    """
    Service xử lý OCR và embeddings

    Luồng:
    1. NestJS upload file lên R2, tạo UserStorage với status=PENDING
    2. NestJS gọi API này với userStorageId
    3. Service download từ R2 URL, OCR, lưu embeddings
    4. Update status = COMPLETED
    """

    _instance = None
    _pool: Optional[asyncpg.Pool] = None

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
            logger.info("PostgreSQL connection pool created for OCRProcessingService")

        return self._pool

    async def get_file_info(self, user_storage_id: str) -> Optional[FileInfo]:
        """Get file info from UserStorage (created by NestJS)"""
        pool = await self._get_pool()

        query = """
            SELECT id, "userId", filename, url, mimetype, "processingStatus"
            FROM "UserStorage"
            WHERE id = $1
        """

        async with pool.acquire() as conn:
            row = await conn.fetchrow(query, user_storage_id)

            if row:
                return FileInfo(
                    id=row['id'],
                    user_id=row['userId'],
                    filename=row['filename'],
                    url=row['url'],
                    mimetype=row['mimetype'],
                    processing_status=row['processingStatus']
                )

        return None

    async def is_already_processed(self, user_storage_id: str) -> bool:
        """Check if file already processed (OCR cached)"""
        file_info = await self.get_file_info(user_storage_id)
        return file_info is not None and file_info.processing_status == "COMPLETED"

    async def get_document_chunks(self, user_storage_id: str) -> List[DocumentChunk]:
        """Get all OCR'd chunks for a file"""
        pool = await self._get_pool()

        query = """
            SELECT id, "userStorageId", "pageRange", title, content, "createdAt"
            FROM "Document"
            WHERE "userStorageId" = $1
            ORDER BY "createdAt"
        """

        chunks = []
        async with pool.acquire() as conn:
            rows = await conn.fetch(query, user_storage_id)

            for row in rows:
                chunks.append(DocumentChunk(
                    id=row['id'],
                    user_storage_id=row['userStorageId'],
                    page_range=row['pageRange'],
                    title=row['title'],
                    content=row['content'],
                    created_at=row['createdAt']
                ))

        return chunks

    async def update_processing_status(
        self,
        user_storage_id: str,
        status: str,
        credit_charged: bool = False
    ):
        """Update file processing status"""
        pool = await self._get_pool()

        query = """
            UPDATE "UserStorage"
            SET "processingStatus" = $2, "creditCharged" = $3, "updatedAt" = NOW()
            WHERE id = $1
        """

        async with pool.acquire() as conn:
            await conn.execute(query, user_storage_id, status, credit_charged)
            logger.info(f"Updated file {user_storage_id} status to {status}")

    async def store_document_chunk(
        self,
        chunk_id: str,
        user_storage_id: str,
        page_range: str,
        title: Optional[str],
        content: str,
        embeddings: List[float]
    ):
        """Store document chunk with embeddings"""
        pool = await self._get_pool()

        embedding_str = "[" + ",".join(map(str, embeddings)) + "]"

        query = """
            INSERT INTO "Document"
                (id, "userStorageId", "pageRange", title, content, embeddings, "createdAt", "updatedAt")
            VALUES ($1, $2, $3, $4, $5, $6::vector, NOW(), NOW())
            ON CONFLICT (id) DO UPDATE SET
                content = EXCLUDED.content,
                embeddings = EXCLUDED.embeddings,
                "updatedAt" = NOW()
        """

        async with pool.acquire() as conn:
            await conn.execute(
                query, chunk_id, user_storage_id, page_range, title, content, embedding_str
            )

    async def download_file_from_r2(self, url: str) -> Tuple[bytes, str]:
        """
        Download file from R2 public URL
        Returns: (file_content, temp_file_path)
        """
        from urllib.parse import quote, urlparse, urlunparse

        # Encode URL path to handle spaces and special characters
        parsed = urlparse(url)
        encoded_path = quote(parsed.path, safe='/')
        encoded_url = urlunparse(parsed._replace(path=encoded_path))

        logger.info(f"Downloading from encoded URL: {encoded_url}")

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.get(encoded_url)
            response.raise_for_status()
            content = response.content

        # Determine file extension from URL
        ext = os.path.splitext(url.split('?')[0])[1] or '.pdf'

        # Save to temp file
        with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as f:
            f.write(content)
            temp_path = f.name

        return content, temp_path

    def _is_pdf_file(self, file_info: FileInfo) -> bool:
        """Check whether the current file should use the PDF OCR flow."""
        return file_info.mimetype == "application/pdf" or file_info.url.lower().endswith('.pdf')

    def _create_text_splitter(self, is_pdf: bool) -> RecursiveCharacterTextSplitter:
        """Create a text splitter aligned with the HTTP ingest path."""
        chunk_size, chunk_overlap, embed_limit = _resolve_text_splitter_config()
        logger.info(
            f"Text splitter config: chunk_size={chunk_size}, chunk_overlap={chunk_overlap}, embed_limit={embed_limit}"
        )

        splitter_kwargs: Dict[str, Any] = {
            "chunk_size": chunk_size,
            "chunk_overlap": chunk_overlap,
        }
        if is_pdf:
            splitter_kwargs["separators"] = ["\n\n", "\n", ". ", " ", ""]

        return RecursiveCharacterTextSplitter(**splitter_kwargs)

    def _build_pdf_documents_to_store(
        self,
        user_storage_id: str,
        chunk_results: List[Tuple[int, str]]
    ) -> List[Dict[str, Any]]:
        """Convert PDF OCR chunk results into vector-store documents."""
        text_splitter = self._create_text_splitter(is_pdf=True)
        documents_to_store: List[Dict[str, Any]] = []
        chunk_idx = 0

        for page_chunk_index, page_chunk_text in chunk_results:
            if not page_chunk_text or not page_chunk_text.strip():
                continue

            text_chunks = text_splitter.split_text(page_chunk_text)
            logger.info(
                f"📝 Page chunk {page_chunk_index}: {len(page_chunk_text)} chars → {len(text_chunks)} text chunks"
            )

            for text_chunk in text_chunks:
                content = text_chunk.strip()
                if not content:
                    continue

                documents_to_store.append({
                    "id": f"{user_storage_id}_chunk_{chunk_idx}",
                    "user_storage_id": user_storage_id,
                    "content": content,
                    "page_range": str(page_chunk_index),
                    "title": f"Chunk {chunk_idx + 1}",
                })
                chunk_idx += 1

        return documents_to_store

    def _build_text_documents_to_store(self, user_storage_id: str, text: str) -> List[Dict[str, Any]]:
        """Split plain extracted text into vector-store documents."""
        text_splitter = self._create_text_splitter(is_pdf=False)
        documents_to_store: List[Dict[str, Any]] = []

        for chunk_index, text_chunk in enumerate(text_splitter.split_text(text)):
            content = text_chunk.strip()
            if not content:
                continue

            documents_to_store.append({
                "id": f"{user_storage_id}_chunk_{chunk_index}",
                "user_storage_id": user_storage_id,
                "content": content,
                "page_range": str(chunk_index + 1),
                "title": f"Chunk {chunk_index + 1}",
            })

        return documents_to_store

    async def prepare_documents_to_store(
        self,
        user_storage_id: str,
        file_info: FileInfo,
        file_bytes: Optional[bytes] = None,
        temp_path: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Prepare OCR/extracted chunks in the batch document shape used by the vector store."""
        should_cleanup_temp = False

        if file_bytes is None or temp_path is None:
            file_bytes, temp_path = await self.download_file_from_r2(file_info.url)
            should_cleanup_temp = True

        try:
            if self._is_pdf_file(file_info):
                logger.info("📄 Processing PDF with local Tesseract/PyPDF...")
                from backend.services.pdf_ocr_service import pdf_ocr_service

                chunk_results = pdf_ocr_service.process_pdf_with_chunks(file_bytes)
                documents_to_store = self._build_pdf_documents_to_store(user_storage_id, chunk_results)
            else:
                logger.info(f"📝 Processing non-PDF file: {file_info.mimetype}")
                from src.rag.retriever import extract_text_from_file

                extracted_text = extract_text_from_file(temp_path, file_info.mimetype)
                if (
                    extracted_text.startswith("Error")
                    or extracted_text.startswith("Unsupported")
                    or extracted_text.startswith("No readable text content")
                    or "not available" in extracted_text
                ):
                    raise FileExtractionError(extracted_text)

                documents_to_store = self._build_text_documents_to_store(user_storage_id, extracted_text)

            if not documents_to_store:
                raise NoContentExtractedError("No content could be extracted from file")

            return documents_to_store
        finally:
            if should_cleanup_temp and temp_path and os.path.exists(temp_path):
                os.unlink(temp_path)

    async def delete_documents(self, user_storage_id: str) -> int:
        """Delete all documents for a file"""
        pool = await self._get_pool()

        async with pool.acquire() as conn:
            result = await conn.execute(
                'DELETE FROM "Document" WHERE "userStorageId" = $1',
                user_storage_id
            )
            count = int(result.split()[-1])
            logger.info(f"Deleted {count} documents for file {user_storage_id}")
            return count

    async def search_similar_documents(
        self,
        user_storage_ids: List[str],
        query_embedding: List[float],
        limit: int = 5,
        similarity_threshold: float = 0.7
    ) -> List[Tuple[DocumentChunk, float]]:
        """Search similar documents using cosine similarity"""
        pool = await self._get_pool()

        embedding_str = "[" + ",".join(map(str, query_embedding)) + "]"

        query = """
            SELECT id, "userStorageId", "pageRange", title, content, "createdAt",
                   1 - (embeddings <=> $1::vector) as similarity
            FROM "Document"
            WHERE "userStorageId" = ANY($2::text[])
              AND 1 - (embeddings <=> $1::vector) >= $3
            ORDER BY embeddings <=> $1::vector
            LIMIT $4
        """

        results = []
        async with pool.acquire() as conn:
            rows = await conn.fetch(query, embedding_str, user_storage_ids, similarity_threshold, limit)

            for row in rows:
                chunk = DocumentChunk(
                    id=row['id'],
                    user_storage_id=row['userStorageId'],
                    page_range=row['pageRange'],
                    title=row['title'],
                    content=row['content'],
                    created_at=row['createdAt']
                )
                results.append((chunk, row['similarity']))

        return results

    async def update_file_status(self, user_storage_id: str, status: str):
        """Convenience method to update file status (for RabbitMQ consumer)"""
        await self.update_processing_status(user_storage_id, status)

    async def process_file(self, user_storage_id: str, model_type: str = "gemini") -> dict:
        """
        Process a file for OCR (for RabbitMQ consumer)

        Returns:
            dict with success, chunks_count, or error
        """
        try:
            file_info = await self.get_file_info(user_storage_id)
            if not file_info:
                return {"success": False, "error": "File not found"}

            from src.rag.vector_store_pg import get_pg_vector_store

            documents_to_store = await self.prepare_documents_to_store(
                user_storage_id=user_storage_id,
                file_info=file_info,
            )

            logger.info(f"📦 Storing {len(documents_to_store)} text chunks...")
            vector_store = get_pg_vector_store()
            chunks_saved = await vector_store.store_documents_batch(
                documents_to_store,
                model_type=model_type,
            )

            if chunks_saved == 0:
                raise NoContentExtractedError("No content could be extracted from file")

            await self.update_processing_status(user_storage_id, "COMPLETED", credit_charged=True)
            return {"success": True, "chunks_count": chunks_saved}

        except Exception as e:
            logger.exception(f"Error processing file {user_storage_id}: {e}")
            await self.update_processing_status(user_storage_id, "FAILED")
            return {"success": False, "error": str(e)}

    async def close(self):
        """Close connection pool"""
        if self._pool:
            await self._pool.close()
            self._pool = None


# Singleton instance
ocr_service = OCRProcessingService()
