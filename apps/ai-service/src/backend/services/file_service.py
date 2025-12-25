"""
File Service - Quản lý file uploads với PostgreSQL storage và OCR caching

Service này connect trực tiếp PostgreSQL để:
1. Lưu/lấy file metadata từ UserStorage table
2. Cache OCR results trong Document table với embeddings
3. Tránh re-OCR files đã được xử lý
"""

import os
import hashlib
import logging
import asyncio
from typing import Optional, List, Dict, Any, Tuple
from datetime import datetime
from dataclasses import dataclass

import asyncpg

logger = logging.getLogger(__name__)


@dataclass
class FileMetadata:
    """File metadata from UserStorage table"""
    id: str
    user_id: str
    filename: str
    url: str
    mimetype: str
    size: int
    processing_status: str  # PENDING | PROCESSING | COMPLETED | FAILED
    credit_charged: bool
    created_at: datetime


@dataclass
class DocumentChunk:
    """Document chunk with embedding"""
    id: str
    user_storage_id: str
    page_range: str
    title: Optional[str]
    content: str
    created_at: datetime


class FileService:
    """
    Service quản lý file uploads và OCR caching với PostgreSQL

    Sử dụng chung database với NestJS exam-service để:
    - Sync file metadata
    - Tái sử dụng OCR results
    - Vector search với pgvector
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
            postgres_uri = os.environ.get("POSTGRES_URI")
            if not postgres_uri:
                raise ValueError("POSTGRES_URI environment variable not set")

            self._pool = await asyncpg.create_pool(
                postgres_uri,
                min_size=2,
                max_size=10,
                command_timeout=60
            )
            logger.info("PostgreSQL connection pool created for FileService")

        return self._pool

    @staticmethod
    def compute_file_hash(content: bytes) -> str:
        """Compute SHA256 hash of file content"""
        return hashlib.sha256(content).hexdigest()

    async def check_file_exists(self, user_id: str, file_hash: str) -> Optional[FileMetadata]:
        """
        Check if file with same hash already exists for user
        Returns FileMetadata if found and COMPLETED, None otherwise
        """
        pool = await self._get_pool()

        # Query by content hash (stored in keyR2 for simplicity, or add new column)
        # For now, we'll check by filename pattern or URL contains hash
        query = """
            SELECT id, "userId", filename, url, mimetype, size,
                   "processingStatus", "creditCharged", "createdAt"
            FROM "UserStorage"
            WHERE "userId" = $1
              AND "processingStatus" = 'COMPLETED'
              AND url LIKE $2
            LIMIT 1
        """

        async with pool.acquire() as conn:
            row = await conn.fetchrow(query, user_id, f"%{file_hash[:16]}%")

            if row:
                return FileMetadata(
                    id=row['id'],
                    user_id=row['userId'],
                    filename=row['filename'],
                    url=row['url'],
                    mimetype=row['mimetype'],
                    size=row['size'],
                    processing_status=row['processingStatus'],
                    credit_charged=row['creditCharged'],
                    created_at=row['createdAt']
                )

        return None

    async def get_file_by_id(self, file_id: str) -> Optional[FileMetadata]:
        """Get file metadata by ID"""
        pool = await self._get_pool()

        query = """
            SELECT id, "userId", filename, url, mimetype, size,
                   "processingStatus", "creditCharged", "createdAt"
            FROM "UserStorage"
            WHERE id = $1
        """

        async with pool.acquire() as conn:
            row = await conn.fetchrow(query, file_id)

            if row:
                return FileMetadata(
                    id=row['id'],
                    user_id=row['userId'],
                    filename=row['filename'],
                    url=row['url'],
                    mimetype=row['mimetype'],
                    size=row['size'],
                    processing_status=row['processingStatus'],
                    credit_charged=row['creditCharged'],
                    created_at=row['createdAt']
                )

        return None

    async def get_file_documents(self, user_storage_id: str) -> List[DocumentChunk]:
        """Get all document chunks for a file (already OCR'd)"""
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

    async def create_file_record(
        self,
        file_id: str,
        user_id: str,
        filename: str,
        url: str,
        mimetype: str,
        size: int,
        key_r2: str,
        processing_status: str = "PENDING"
    ) -> FileMetadata:
        """Create new file record in UserStorage"""
        pool = await self._get_pool()

        query = """
            INSERT INTO "UserStorage"
                (id, "userId", filename, url, mimetype, size, "keyR2",
                 "processingStatus", "creditCharged", "createdAt", "updatedAt")
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, NOW(), NOW())
            RETURNING id, "userId", filename, url, mimetype, size,
                      "processingStatus", "creditCharged", "createdAt"
        """

        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                query, file_id, user_id, filename, url, mimetype, size, key_r2, processing_status
            )

            return FileMetadata(
                id=row['id'],
                user_id=row['userId'],
                filename=row['filename'],
                url=row['url'],
                mimetype=row['mimetype'],
                size=row['size'],
                processing_status=row['processingStatus'],
                credit_charged=row['creditCharged'],
                created_at=row['createdAt']
            )

    async def update_processing_status(
        self,
        file_id: str,
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
            await conn.execute(query, file_id, status, credit_charged)
            logger.info(f"Updated file {file_id} status to {status}")

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

        # Convert embeddings to PostgreSQL vector format
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

    async def search_similar_documents(
        self,
        user_storage_id: str,
        query_embedding: List[float],
        limit: int = 5,
        similarity_threshold: float = 0.7
    ) -> List[Tuple[DocumentChunk, float]]:
        """
        Search similar documents using cosine similarity
        Returns list of (DocumentChunk, similarity_score)
        """
        pool = await self._get_pool()

        embedding_str = "[" + ",".join(map(str, query_embedding)) + "]"

        query = """
            SELECT id, "userStorageId", "pageRange", title, content, "createdAt",
                   1 - (embeddings <=> $2::vector) as similarity
            FROM "Document"
            WHERE "userStorageId" = $1
              AND 1 - (embeddings <=> $2::vector) >= $3
            ORDER BY embeddings <=> $2::vector
            LIMIT $4
        """

        results = []
        async with pool.acquire() as conn:
            rows = await conn.fetch(query, user_storage_id, embedding_str, similarity_threshold, limit)

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

    async def delete_file_documents(self, user_storage_id: str):
        """Delete all documents for a file"""
        pool = await self._get_pool()

        query = 'DELETE FROM "Document" WHERE "userStorageId" = $1'

        async with pool.acquire() as conn:
            result = await conn.execute(query, user_storage_id)
            logger.info(f"Deleted documents for file {user_storage_id}: {result}")

    async def get_user_files(
        self,
        user_id: str,
        limit: int = 50,
        offset: int = 0
    ) -> List[FileMetadata]:
        """Get all files for a user with pagination"""
        pool = await self._get_pool()

        query = """
            SELECT id, "userId", filename, url, mimetype, size,
                   "processingStatus", "creditCharged", "createdAt"
            FROM "UserStorage"
            WHERE "userId" = $1
            ORDER BY "createdAt" DESC
            LIMIT $2 OFFSET $3
        """

        files = []
        async with pool.acquire() as conn:
            rows = await conn.fetch(query, user_id, limit, offset)

            for row in rows:
                files.append(FileMetadata(
                    id=row['id'],
                    user_id=row['userId'],
                    filename=row['filename'],
                    url=row['url'],
                    mimetype=row['mimetype'],
                    size=row['size'],
                    processing_status=row['processingStatus'],
                    credit_charged=row['creditCharged'],
                    created_at=row['createdAt']
                ))

        return files

    async def close(self):
        """Close connection pool"""
        if self._pool:
            await self._pool.close()
            self._pool = None
            logger.info("FileService connection pool closed")


# Singleton instance
file_service = FileService()
