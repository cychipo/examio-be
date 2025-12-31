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
import hashlib
import logging
import tempfile
import httpx
from typing import Optional, List, Tuple
from datetime import datetime
from dataclasses import dataclass

import asyncpg

logger = logging.getLogger(__name__)


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

    async def process_file(self, user_storage_id: str) -> dict:
        """
        Process a file for OCR (for RabbitMQ consumer)

        Returns:
            dict with success, chunks_count, or error
        """
        try:
            # Get file info
            file_info = await self.get_file_info(user_storage_id)
            if not file_info:
                return {"success": False, "error": "File not found"}

            # Download file
            _, temp_path = await self.download_file_from_r2(file_info.url)

            # Import here to avoid circular imports
            from rag.retriever import extract_text_from_file
            from rag.vector_store_pg import get_pg_vector_store

            # Extract text
            text = extract_text_from_file(temp_path)
            if not text or len(text.strip()) < 10:
                await self.update_processing_status(user_storage_id, "FAILED")
                return {"success": False, "error": "No text extracted from file"}

            # Chunk text
            chunks = self._chunk_text(text)

            # Get vector store and save chunks
            vector_store = await get_pg_vector_store()
            chunks_saved = 0

            for i, chunk in enumerate(chunks):
                chunk_id = f"{user_storage_id}_chunk_{i}"
                page_range = f"{i+1}-{i+1}"

                # Get embedding
                embedding = await vector_store.get_embedding(chunk)

                # Store chunk
                await self.store_document_chunk(
                    chunk_id=chunk_id,
                    user_storage_id=user_storage_id,
                    page_range=page_range,
                    title=f"Chunk {i+1}",
                    content=chunk,
                    embeddings=embedding
                )
                chunks_saved += 1

            # Update status
            await self.update_processing_status(user_storage_id, "COMPLETED", credit_charged=True)

            # Cleanup temp file
            import os as os_module
            if os_module.path.exists(temp_path):
                os_module.unlink(temp_path)

            return {"success": True, "chunks_count": chunks_saved}

        except Exception as e:
            logger.exception(f"Error processing file {user_storage_id}: {e}")
            await self.update_processing_status(user_storage_id, "FAILED")
            return {"success": False, "error": str(e)}

    def _chunk_text(self, text: str, chunk_size: int = 1000, overlap: int = 200) -> List[str]:
        """Split text into overlapping chunks"""
        chunks = []
        start = 0
        while start < len(text):
            end = start + chunk_size
            chunk = text[start:end]
            if chunk.strip():
                chunks.append(chunk)
            start = end - overlap
        return chunks

    async def close(self):
        """Close connection pool"""
        if self._pool:
            await self._pool.close()
            self._pool = None


# Singleton instance
ocr_service = OCRProcessingService()
