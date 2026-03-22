"""
PgVectorStore - Lưu trữ và tìm kiếm vector embeddings trong PostgreSQL với pgvector.
Port từ NestJS ai.service.ts vector search sang Python.

Features:
- Lưu document embeddings vào PostgreSQL với pgvector extension
- Tìm kiếm similar documents bằng cosine similarity
- Tích hợp với GeminiClient để tạo embeddings
"""

import os
import logging
import asyncio
import time
from typing import List, Optional, Dict, Any
from dataclasses import dataclass
from datetime import datetime
import asyncpg
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)


@dataclass
class DocumentChunk:
    """Đại diện cho một chunk của document."""
    id: str
    user_storage_id: str
    content: str
    page_range: str
    title: Optional[str] = None
    similarity_score: Optional[float] = None
    created_at: Optional[datetime] = None


class PgVectorStore:
    """
    Vector Store sử dụng PostgreSQL với pgvector extension.

    Cấu hình:
    - DATABASE_URL: Connection string tới PostgreSQL
    """

    VECTOR_SEARCH_CONFIG = {
        "TOP_K": 15,
        "SIMILARITY_THRESHOLD": 0.7,
        "MAX_KEYWORDS": 10,
        "EMBEDDING_MODEL": "models/embedding-001",
    }

    def __init__(self, connection_string: Optional[str] = None):
        self.connection_string = connection_string or os.getenv("DATABASE_URL")
        self._pool: Optional[asyncpg.Pool] = None

    async def _get_pool(self) -> asyncpg.Pool:
        """Lấy hoặc tạo connection pool."""
        if self._pool is None:
            self._pool = await asyncpg.create_pool(
                self.connection_string,
                min_size=2,
                max_size=10
            )
        return self._pool

    async def close(self):
        """Đóng connection pool."""
        if self._pool:
            await self._pool.close()
            self._pool = None

    async def create_embedding(
        self,
        text: str,
        task_type: str = "retrieval_document",
        model_type: str = "qwen3_8b"
    ) -> List[float]:
        """
        Tạo embedding vector cho text bằng Ollama embedding model.

        Lưu ý: luôn dùng cùng 1 embedding space để đảm bảo retrieval nhất quán
        giữa các lần generate, khong phu thuoc model generation do user chon.

        Args:
            text: Text cần embedding
            task_type: "retrieval_document" cho documents, "retrieval_query" cho queries
            model_type: Ignored (giữ để tương thích interface cũ)
        """
        from src.llm.ollama_embeddings import ollama_embeddings
        return await ollama_embeddings.create_embedding(text, task_type)

    async def create_embeddings_batch(
        self,
        texts: List[str],
        task_type: str = "retrieval_document",
        model_type: str = "qwen3_8b"
    ) -> List[List[float]]:
        """
        Tạo embeddings cho nhiều texts bằng Ollama embedding model.

        Lưu ý: luôn dùng cùng 1 embedding space để đảm bảo retrieval nhất quán.

        Args:
            texts: List texts cần embedding
            task_type: Task type
            model_type: Ignored (giữ để tương thích interface cũ)
        """
        from src.llm.ollama_embeddings import ollama_embeddings
        return await ollama_embeddings.create_embeddings_batch(texts, task_type)

    async def store_document(
        self,
        doc_id: str,
        user_storage_id: str,
        content: str,
        page_range: str,
        title: Optional[str] = None,
        model_type: str = "qwen3_8b"
    ) -> bool:
        """
        Lưu document chunk với embedding vào database.

        Args:
            doc_id: ID của document chunk
            user_storage_id: ID của file gốc (UserStorage)
            content: Nội dung text
            page_range: Phạm vi trang (vd: "1-3")
            title: Tiêu đề (optional)
            model_type: Ignored, giu lai de tuong thich interface cu

        Returns:
            True nếu thành công
        """
        try:
            # Tạo embedding cho content
            embedding = await self.create_embedding(content, model_type=model_type)

            pool = await self._get_pool()

            # Insert with ON CONFLICT UPDATE
            await pool.execute(
                """
                INSERT INTO "Document" (id, "userStorageId", content, "pageRange", title, embeddings, "createdAt", "updatedAt")
                VALUES ($1, $2, $3, $4, $5, $6::vector, NOW(), NOW())
                ON CONFLICT (id) DO UPDATE SET
                    content = EXCLUDED.content,
                    embeddings = EXCLUDED.embeddings,
                    "updatedAt" = NOW()
                """,
                doc_id,
                user_storage_id,
                content,
                page_range,
                title,
                f"[{','.join(str(v) for v in embedding)}]"
            )

            print(f"✅ Stored document {doc_id} with {len(embedding)}-dim embedding")
            return True

        except Exception as e:
            print(f"❌ Error storing document: {e}")
            return False

    async def store_documents_batch(
        self,
        documents: List[Dict[str, Any]],
        model_type: str = "qwen3_8b"
    ) -> int:
        """
        Lưu nhiều document chunks với batch embedding.

        Args:
            documents: List dict với keys: id, user_storage_id, content, page_range, title (optional)
            model_type: Ignored, giu lai de tuong thich interface cu

        Returns:
            Số documents được lưu thành công
        """
        if not documents:
            return 0

        try:
            total_start = time.perf_counter()

            # Tạo batch embeddings
            embedding_start = time.perf_counter()
            contents = [doc['content'] for doc in documents]
            embeddings = await self.create_embeddings_batch(contents, "retrieval_document", model_type=model_type)
            embedding_ms = int((time.perf_counter() - embedding_start) * 1000)

            pool = await self._get_pool()
            success_count = 0
            upsert_query = """
                INSERT INTO "Document" (id, "userStorageId", content, "pageRange", title, embeddings, "createdAt", "updatedAt")
                VALUES ($1, $2, $3, $4, $5, $6::vector, NOW(), NOW())
                ON CONFLICT (id) DO UPDATE SET
                    content = EXCLUDED.content,
                    embeddings = EXCLUDED.embeddings,
                    "updatedAt" = NOW()
            """
            records = [
                (
                    doc['id'],
                    doc['user_storage_id'],
                    doc['content'],
                    doc['page_range'],
                    doc.get('title'),
                    f"[{','.join(str(v) for v in embeddings[i])}]"
                )
                for i, doc in enumerate(documents)
            ]

            store_start = time.perf_counter()
            try:
                # Fast path: transaction + executemany to reduce round-trips
                async with pool.acquire() as conn:
                    async with conn.transaction():
                        await conn.executemany(upsert_query, records)
                success_count = len(records)
            except Exception as batch_upsert_error:
                # Fallback path: keep existing per-row upsert behavior
                logger.warning("Batch upsert failed, falling back to per-row upsert")
                logger.debug(f"Batch upsert error: {batch_upsert_error}")
                for i, doc in enumerate(documents):
                    try:
                        await pool.execute(upsert_query, *records[i])
                        success_count += 1
                    except Exception as row_error:
                        logger.error(f"Error storing document {doc['id']}: {row_error}")

            store_ms = int((time.perf_counter() - store_start) * 1000)
            total_ms = int((time.perf_counter() - total_start) * 1000)
            logger.info(
                f"[AI_TIMING] stage=vector_store_batch documents={len(documents)} success_count={success_count} "
                f"embedding_ms={embedding_ms} store_ms={store_ms} total_ms={total_ms}"
            )
            logger.info(f"Stored {success_count}/{len(documents)} documents with batch embedding")
            return success_count

        except Exception as e:
            logger.warning("Error in batch store, falling back to individual document storage")
            logger.debug(f"Batch store error: {e}")
            fallback_start = time.perf_counter()
            success_count = 0
            for doc in documents:
                success = await self.store_document(
                    doc['id'],
                    doc['user_storage_id'],
                    doc['content'],
                    doc['page_range'],
                    doc.get('title'),
                    model_type=model_type
                )
                if success:
                    success_count += 1
            store_ms = int((time.perf_counter() - fallback_start) * 1000)
            logger.info(
                f"[AI_TIMING] stage=vector_store_batch_fallback documents={len(documents)} success_count={success_count} store_ms={store_ms}"
            )
            return success_count

    async def search_similar(
        self,
        user_storage_ids: List[str],
        query: str,
        top_k: int = None,
        similarity_threshold: float = None,
        model_type: str = "qwen3_8b"
    ) -> List[DocumentChunk]:
        """
        Tìm kiếm documents tương tự bằng vector similarity.

        Args:
            user_storage_ids: Danh sách file IDs để search trong
            query: Query text
            top_k: Số kết quả trả về (default: 15)
            similarity_threshold: Ngưỡng similarity (default: 0.7)
            model_type: Ignored, giu lai de tuong thich interface cu
        """
        top_k = top_k or self.VECTOR_SEARCH_CONFIG["TOP_K"]
        similarity_threshold = similarity_threshold or self.VECTOR_SEARCH_CONFIG["SIMILARITY_THRESHOLD"]

        try:
            # Tạo embedding cho query (dùng task_type khác với document)
            query_embedding = await self.create_embedding(query, task_type="retrieval_query", model_type=model_type)

            pool = await self._get_pool()

            # Query với cosine similarity
            # 1 - (embedding <=> query_embedding) = cosine similarity
            rows = await pool.fetch(
                """
                SELECT
                    id, "userStorageId", "pageRange", title, content, "createdAt",
                    1 - (embeddings <=> $1::vector) as similarity_score
                FROM "Document"
                WHERE "userStorageId" = ANY($2::text[])
                  AND 1 - (embeddings <=> $1::vector) > $3
                ORDER BY embeddings <=> $1::vector ASC
                LIMIT $4
                """,
                f"[{','.join(str(v) for v in query_embedding)}]",
                user_storage_ids,
                similarity_threshold,
                top_k
            )

            results = [
                DocumentChunk(
                    id=row["id"],
                    user_storage_id=row["userStorageId"],
                    page_range=row["pageRange"],
                    title=row["title"],
                    content=row["content"],
                    similarity_score=row["similarity_score"],
                    created_at=row["createdAt"]
                )
                for row in rows
            ]

            logger.info(f"Found {len(results)} similar documents (threshold: {similarity_threshold})")
            return results

        except Exception as e:
            print(f"❌ Error in vector search: {e}")
            return []

    async def search_and_combine(
        self,
        user_storage_ids: List[str],
        query: str,
        top_k: int = 5,
        max_content_length: int = 6000
    ) -> Optional[str]:
        """
        Tìm kiếm tương tự và kết hợp content từ các chunks.
        Tương thích với searchDocumentsByQuery trong NestJS.

        Args:
            user_storage_ids: Danh sách file IDs
            query: Query text
            top_k: Số chunks tối đa
            max_content_length: Độ dài content tối đa

        Returns:
            Combined content string hoặc None nếu không tìm thấy
        """
        similar_docs = await self.search_similar(
            user_storage_ids,
            query,
            top_k=top_k,
            similarity_threshold=0.5  # Lower threshold cho chat context
        )

        if not similar_docs:
            return None

        combined_content = ""
        for doc in similar_docs:
            chunk = f"[Trang {doc.page_range}]: {doc.content}\n\n"
            if len(combined_content) + len(chunk) > max_content_length:
                break
            combined_content += chunk

        return combined_content.strip() or None

    async def delete_by_user_storage(self, user_storage_id: str) -> int:
        """Xóa tất cả documents của một UserStorage."""
        try:
            pool = await self._get_pool()
            result = await pool.execute(
                'DELETE FROM "Document" WHERE "userStorageId" = $1',
                user_storage_id
            )
            count = int(result.split()[-1])
            print(f"🗑️ Deleted {count} documents for userStorageId: {user_storage_id}")
            return count
        except Exception as e:
            print(f"❌ Error deleting documents: {e}")
            return 0


# Singleton instance
_pg_vector_store: Optional[PgVectorStore] = None


def get_pg_vector_store() -> PgVectorStore:
    """Get singleton PgVectorStore instance."""
    global _pg_vector_store
    if _pg_vector_store is None:
        _pg_vector_store = PgVectorStore()
    return _pg_vector_store
