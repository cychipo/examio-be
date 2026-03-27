from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Optional

import asyncpg

logger = logging.getLogger(__name__)


def _normalize_timestamp(value: Any) -> Any:
    if value is None or isinstance(value, datetime):
        return value
    if isinstance(value, str):
        return datetime.fromisoformat(value)
    return value


@dataclass
class TutorKnowledgeFileRecord:
    file_id: str
    status: str
    progress: int
    chunk_count: int
    vector_count: int
    error_message: Optional[str]
    url: str


class TutorKnowledgeStorageService:
    _instance = None
    _pool: Optional[asyncpg.Pool] = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    async def _get_pool(self) -> asyncpg.Pool:
        if self._pool is None or self._pool._closed:
            postgres_uri = os.environ.get('DATABASE_URL')
            if not postgres_uri:
                raise ValueError('DATABASE_URL environment variable not set')

            self._pool = await asyncpg.create_pool(
                postgres_uri,
                min_size=2,
                max_size=10,
                command_timeout=60,
            )
            logger.info('PostgreSQL connection pool created for TutorKnowledgeStorageService')

        return self._pool

    async def ensure_schema(self) -> None:
        pool = await self._get_pool()
        statements = [
            'CREATE EXTENSION IF NOT EXISTS vector',
            """
            CREATE TABLE IF NOT EXISTS \"TutorKnowledgeFolder\" (
                id TEXT PRIMARY KEY,
                \"userId\" TEXT NOT NULL,
                name TEXT NOT NULL,
                description TEXT,
                icon TEXT NOT NULL,
                metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                \"createdAt\" TIMESTAMP NOT NULL DEFAULT NOW(),
                \"updatedAt\" TIMESTAMP NOT NULL DEFAULT NOW()
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS \"TutorKnowledgeFile\" (
                id TEXT PRIMARY KEY,
                \"userId\" TEXT NOT NULL,
                filename TEXT NOT NULL,
                description TEXT,
                url TEXT NOT NULL,
                \"keyR2\" TEXT NOT NULL,
                \"mimeType\" TEXT NOT NULL,
                size BIGINT NOT NULL,
                status TEXT NOT NULL DEFAULT 'PENDING',
                progress INTEGER NOT NULL DEFAULT 0,
                \"folderId\" TEXT,
                \"folderName\" TEXT,
                \"folderDescription\" TEXT,
                \"courseCode\" TEXT,
                language TEXT,
                topic TEXT,
                difficulty TEXT,
                \"sourceType\" TEXT,
                \"chunkCount\" INTEGER NOT NULL DEFAULT 0,
                \"vectorCount\" INTEGER NOT NULL DEFAULT 0,
                \"embeddingModel\" TEXT,
                \"errorMessage\" TEXT,
                metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                \"createdAt\" TIMESTAMP NOT NULL DEFAULT NOW(),
                \"updatedAt\" TIMESTAMP NOT NULL DEFAULT NOW(),
                \"completedAt\" TIMESTAMP
            )
            """,
            'ALTER TABLE "TutorKnowledgeFile" ADD COLUMN IF NOT EXISTS description TEXT',
            """
            CREATE TABLE IF NOT EXISTS \"TutorKnowledgeVector\" (
                id TEXT PRIMARY KEY,
                \"fileId\" TEXT NOT NULL REFERENCES \"TutorKnowledgeFile\"(id) ON DELETE CASCADE,
                \"chunkIndex\" INTEGER NOT NULL,
                content TEXT NOT NULL,
                \"contentType\" TEXT NOT NULL,
                checksum TEXT NOT NULL,
                \"tokenCount\" INTEGER NOT NULL,
                \"embeddingModel\" TEXT,
                embeddings vector,
                metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                \"createdAt\" TIMESTAMP NOT NULL DEFAULT NOW(),
                \"updatedAt\" TIMESTAMP NOT NULL DEFAULT NOW()
            )
            """,
            'CREATE INDEX IF NOT EXISTS "TutorKnowledgeFolder_userId_idx" ON "TutorKnowledgeFolder"("userId")',
            'CREATE INDEX IF NOT EXISTS "TutorKnowledgeFile_userId_idx" ON "TutorKnowledgeFile"("userId")',
            'CREATE INDEX IF NOT EXISTS "TutorKnowledgeFile_status_idx" ON "TutorKnowledgeFile"(status)',
            'CREATE INDEX IF NOT EXISTS "TutorKnowledgeVector_fileId_idx" ON "TutorKnowledgeVector"("fileId")',
        ]

        async with pool.acquire() as conn:
            for statement in statements:
                await conn.execute(statement)

        logger.info('Ensured tutor knowledge file tables exist')

    async def create_file(self, payload: dict[str, Any]) -> None:
        pool = await self._get_pool()
        query = """
            INSERT INTO "TutorKnowledgeFile" (
                id, "userId", filename, description, url, "keyR2", "mimeType", size, status, progress,
                "folderId", "folderName", "folderDescription", "courseCode", language,
                topic, difficulty, "sourceType", "chunkCount", "vectorCount", "embeddingModel",
                "errorMessage", metadata, "createdAt", "updatedAt", "completedAt"
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                $11, $12, $13, $14, $15,
                $16, $17, $18, $19, $20, $21,
                $22, $23::jsonb, $24, $25, $26
            )
        """
        async with pool.acquire() as conn:
            await conn.execute(
                query,
                payload['fileId'],
                payload['userId'],
                payload['filename'],
                payload.get('description'),
                payload['url'],
                payload['keyR2'],
                payload['mimeType'],
                payload['size'],
                payload['status'],
                payload['progress'],
                payload.get('folderId'),
                payload.get('folderName'),
                payload.get('folderDescription'),
                payload.get('courseCode'),
                payload.get('language'),
                payload.get('topic'),
                payload.get('difficulty'),
                payload.get('sourceType'),
                payload.get('chunkCount', 0),
                payload.get('vectorCount', 0),
                payload.get('embeddingModel'),
                payload.get('errorMessage'),
                json.dumps(payload.get('metadata', {})),
                _normalize_timestamp(payload['createdAt']),
                _normalize_timestamp(payload['updatedAt']),
                _normalize_timestamp(payload.get('completedAt')),
            )

    async def create_folder(self, payload: dict[str, Any]) -> dict[str, Any]:
        pool = await self._get_pool()
        query = """
            INSERT INTO "TutorKnowledgeFolder" (
                id, "userId", name, description, icon, metadata, "createdAt", "updatedAt"
            ) VALUES (
                $1, $2, $3, $4, $5, $6::jsonb, $7, $8
            )
        """
        async with pool.acquire() as conn:
            await conn.execute(
                query,
                payload['folderId'],
                payload['userId'],
                payload['name'],
                payload.get('description'),
                payload['icon'],
                json.dumps(payload.get('metadata', {})),
                _normalize_timestamp(payload['createdAt']),
                _normalize_timestamp(payload['updatedAt']),
            )
        folder = await self.get_folder(payload['folderId'])
        if folder is None:
            raise RuntimeError('Created folder could not be reloaded')
        return folder

    async def update_folder(self, payload: dict[str, Any]) -> dict[str, Any]:
        pool = await self._get_pool()
        query = """
            UPDATE "TutorKnowledgeFolder"
            SET name = $2,
                description = $3,
                icon = $4,
                metadata = $5::jsonb,
                "updatedAt" = $6
            WHERE id = $1
        """
        async with pool.acquire() as conn:
            await conn.execute(
                query,
                payload['folderId'],
                payload['name'],
                payload.get('description'),
                payload['icon'],
                json.dumps(payload.get('metadata', {})),
                _normalize_timestamp(payload['updatedAt']),
            )
        folder = await self.get_folder(payload['folderId'])
        if folder is None:
            raise RuntimeError('Updated folder could not be reloaded')
        return folder

    async def delete_folder(self, folder_id: str) -> list[dict[str, Any]]:
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            files = await conn.fetch(
                'SELECT id, "keyR2", filename FROM "TutorKnowledgeFile" WHERE "folderId" = $1',
                folder_id,
            )
            await conn.execute('DELETE FROM "TutorKnowledgeFolder" WHERE id = $1', folder_id)
        return [
            {
                'fileId': row['id'],
                'keyR2': row['keyR2'],
                'filename': row['filename'],
            }
            for row in files
        ]

    async def get_folder(self, folder_id: str) -> Optional[dict[str, Any]]:
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow('SELECT * FROM "TutorKnowledgeFolder" WHERE id = $1', folder_id)
        if row is None:
            return None
        return self._map_folder_row(row)

    async def list_folders(self, user_id: str) -> list[dict[str, Any]]:
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT
                    folder.*,
                    COUNT(file.id)::int AS file_count,
                    COUNT(file.id) FILTER (WHERE file.status = 'COMPLETED')::int AS completed_count,
                    COUNT(file.id) FILTER (WHERE file.status IN ('PENDING', 'PROCESSING'))::int AS processing_count,
                    COUNT(file.id) FILTER (WHERE file.status = 'FAILED')::int AS failed_count,
                    COALESCE(SUM(file.size), 0)::bigint AS total_size,
                    COALESCE(SUM(file."vectorCount"), 0)::int AS total_vectors
                FROM "TutorKnowledgeFolder" folder
                LEFT JOIN "TutorKnowledgeFile" file ON file."folderId" = folder.id
                WHERE folder."userId" = $1
                GROUP BY folder.id
                ORDER BY folder."updatedAt" DESC
                """,
                user_id,
            )
        return [self._map_folder_row(row) for row in rows]

    async def update_file(self, payload: dict[str, Any]) -> None:
        pool = await self._get_pool()
        query = """
            UPDATE "TutorKnowledgeFile"
            SET status = $2,
                progress = $3,
                "chunkCount" = $4,
                "vectorCount" = $5,
                "embeddingModel" = $6,
                "errorMessage" = $7,
                metadata = $8::jsonb,
                "updatedAt" = $9,
                "completedAt" = $10
            WHERE id = $1
        """
        async with pool.acquire() as conn:
            await conn.execute(
                query,
                payload['fileId'],
                payload['status'],
                payload['progress'],
                payload.get('chunkCount', 0),
                payload.get('vectorCount', 0),
                payload.get('embeddingModel'),
                payload.get('errorMessage'),
                json.dumps(payload.get('metadata', {})),
                _normalize_timestamp(payload['updatedAt']),
                _normalize_timestamp(payload.get('completedAt')),
            )

    async def replace_vectors(
        self,
        *,
        file_id: str,
        embedding_model: Optional[str],
        vectors: list[dict[str, Any]],
        embeddings: list[list[float]],
    ) -> None:
        pool = await self._get_pool()
        delete_query = 'DELETE FROM "TutorKnowledgeVector" WHERE "fileId" = $1'
        insert_query = """
            INSERT INTO "TutorKnowledgeVector" (
                id, "fileId", "chunkIndex", content, "contentType", checksum,
                "tokenCount", "embeddingModel", embeddings, metadata, "createdAt", "updatedAt"
            ) VALUES (
                $1, $2, $3, $4, $5, $6,
                $7, $8, $9::vector, $10::jsonb, NOW(), NOW()
            )
        """

        records = [
            (
                vector['id'],
                file_id,
                vector['chunkIndex'],
                vector['content'],
                vector['contentType'],
                vector['checksum'],
                vector['tokenCount'],
                embedding_model,
                f"[{','.join(str(v) for v in embeddings[index])}]",
                json.dumps(vector.get('metadata', {})),
            )
            for index, vector in enumerate(vectors)
        ]

        async with pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute(delete_query, file_id)
                if records:
                    await conn.executemany(insert_query, records)

    async def get_file(self, file_id: str) -> Optional[dict[str, Any]]:
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                'SELECT * FROM "TutorKnowledgeFile" WHERE id = $1',
                file_id,
            )

        if row is None:
            return None

        return {
            'fileId': row['id'],
            'userId': row['userId'],
            'filename': row['filename'],
            'description': row['description'],
            'url': row['url'],
            'keyR2': row['keyR2'],
            'mimeType': row['mimeType'],
            'size': row['size'],
            'status': row['status'],
            'progress': row['progress'],
            'folderId': row['folderId'],
            'folderName': row['folderName'],
            'folderDescription': row['folderDescription'],
            'courseCode': row['courseCode'],
            'language': row['language'],
            'topic': row['topic'],
            'difficulty': row['difficulty'],
            'sourceType': row['sourceType'],
            'chunkCount': row['chunkCount'],
            'vectorCount': row['vectorCount'],
            'embeddingModel': row['embeddingModel'],
            'errorMessage': row['errorMessage'],
            'metadata': row['metadata'] or {},
            'createdAt': row['createdAt'].isoformat() if row['createdAt'] else None,
            'updatedAt': row['updatedAt'].isoformat() if row['updatedAt'] else None,
            'completedAt': row['completedAt'].isoformat() if row['completedAt'] else None,
        }

    async def list_files(
        self,
        user_id: str,
        *,
        folder_id: Optional[str] = None,
        status: Optional[str] = None,
        search: Optional[str] = None,
        sort_by: str = 'createdAt',
        sort_order: str = 'desc',
        page: int = 1,
        page_size: int = 12,
    ) -> dict[str, Any]:
        pool = await self._get_pool()
        allowed_sort_fields = {
            'createdAt': '"createdAt"',
            'filename': 'filename',
            'status': 'status',
            'size': 'size',
        }
        sort_field = allowed_sort_fields.get(sort_by, '"createdAt"')
        sort_direction = 'ASC' if sort_order.lower() == 'asc' else 'DESC'
        filters = ['"userId" = $1']
        params: list[Any] = [user_id]
        next_index = 2

        if folder_id:
            filters.append(f'"folderId" = ${next_index}')
            params.append(folder_id)
            next_index += 1
        if status:
            filters.append(f'status = ${next_index}')
            params.append(status)
            next_index += 1
        if search:
            filters.append(
                f'(LOWER(filename) LIKE ${next_index} OR LOWER(COALESCE(description, \'\')) LIKE ${next_index})'
            )
            params.append(f'%{search.lower()}%')
            next_index += 1

        where_clause = ' AND '.join(filters)
        count_query = f'SELECT COUNT(*) AS total FROM "TutorKnowledgeFile" WHERE {where_clause}'
        query = f'SELECT * FROM "TutorKnowledgeFile" WHERE {where_clause} ORDER BY {sort_field} {sort_direction} LIMIT ${next_index} OFFSET ${next_index + 1}'
        params.extend([page_size, max(0, (page - 1) * page_size)])

        async with pool.acquire() as conn:
            total_row = await conn.fetchrow(count_query, *params[:-2])
            rows = await conn.fetch(query, *params)
        return {
            'data': [
                {
                    'fileId': row['id'],
                    'userId': row['userId'],
                    'filename': row['filename'],
                    'description': row['description'],
                    'url': row['url'],
                    'keyR2': row['keyR2'],
                    'mimeType': row['mimeType'],
                    'size': row['size'],
                    'status': row['status'],
                    'progress': row['progress'],
                    'folderId': row['folderId'],
                    'folderName': row['folderName'],
                    'folderDescription': row['folderDescription'],
                    'chunkCount': row['chunkCount'],
                    'vectorCount': row['vectorCount'],
                    'embeddingModel': row['embeddingModel'],
                    'errorMessage': row['errorMessage'],
                    'metadata': row['metadata'] or {},
                    'createdAt': row['createdAt'].isoformat() if row['createdAt'] else None,
                    'completedAt': row['completedAt'].isoformat() if row['completedAt'] else None,
                }
                for row in rows
            ],
            'pagination': {
                'page': page,
                'pageSize': page_size,
                'total': total_row['total'] if total_row else 0,
            },
        }

    async def delete_file(self, file_id: str) -> Optional[dict[str, Any]]:
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                'DELETE FROM "TutorKnowledgeFile" WHERE id = $1 RETURNING *',
                file_id,
            )

        if row is None:
            return None

        return {
            'fileId': row['id'],
            'keyR2': row['keyR2'],
            'filename': row['filename'],
            'folderId': row['folderId'],
        }

    async def get_stats(
        self,
        user_id: str,
        *,
        folder_id: Optional[str] = None,
    ) -> dict[str, Any]:
        pool = await self._get_pool()
        filters = ['"userId" = $1']
        params: list[Any] = [user_id]

        if folder_id:
            filters.append('"folderId" = $2')
            params.append(folder_id)

        where_clause = ' AND '.join(filters)
        query = f"""
            SELECT
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS completed,
                COUNT(*) FILTER (WHERE status IN ('PENDING', 'PROCESSING'))::int AS processing,
                COUNT(*) FILTER (WHERE status = 'FAILED')::int AS failed,
                COALESCE(SUM(size), 0)::bigint AS total_size,
                COALESCE(SUM("vectorCount"), 0)::int AS total_vectors
            FROM "TutorKnowledgeFile"
            WHERE {where_clause}
        """

        async with pool.acquire() as conn:
            row = await conn.fetchrow(query, *params)

        return {
            'total': row['total'] if row else 0,
            'completed': row['completed'] if row else 0,
            'processing': row['processing'] if row else 0,
            'failed': row['failed'] if row else 0,
            'totalSize': row['total_size'] if row else 0,
            'totalVectors': row['total_vectors'] if row else 0,
        }

    def _map_folder_row(self, row: asyncpg.Record) -> dict[str, Any]:
        return {
            'folderId': row['id'],
            'userId': row['userId'],
            'name': row['name'],
            'description': row['description'],
            'icon': row['icon'],
            'fileCount': row['file_count'] if 'file_count' in row else 0,
            'completedCount': row['completed_count'] if 'completed_count' in row else 0,
            'processingCount': row['processing_count'] if 'processing_count' in row else 0,
            'failedCount': row['failed_count'] if 'failed_count' in row else 0,
            'totalSize': row['total_size'] if 'total_size' in row else 0,
            'totalVectors': row['total_vectors'] if 'total_vectors' in row else 0,
            'metadata': row['metadata'] or {},
            'createdAt': row['createdAt'].isoformat() if row['createdAt'] else None,
            'updatedAt': row['updatedAt'].isoformat() if row['updatedAt'] else None,
        }


tutor_knowledge_storage_service = TutorKnowledgeStorageService()
