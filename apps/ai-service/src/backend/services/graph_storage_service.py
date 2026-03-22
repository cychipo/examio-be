import logging
import json
import os
from dataclasses import dataclass
from typing import Any, Dict, List, Optional
from uuid import uuid4

import asyncpg

logger = logging.getLogger(__name__)


@dataclass
class PersistedGraphGroup:
    group_index: int
    community_id: Optional[int]
    page_start: Optional[int]
    page_end: Optional[int]
    page_ranges: List[str]
    chunk_ids: List[str]
    estimated_tokens: int
    char_count: int
    weight: float
    summary: Optional[str]
    metadata: Dict[str, Any]


class GraphStorageService:
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
            logger.info('PostgreSQL connection pool created for GraphStorageService')

        return self._pool

    async def load_graph_state(self, user_storage_id: str) -> Optional[Dict[str, Any]]:
        pool = await self._get_pool()
        query = """
            SELECT id, "graphVersion", "chunkSignature", status,
                   "totalChunks", "totalEdges", "totalCommunities", "totalGroups",
                   metadata, "builtAt", "updatedAt"
            FROM "UserStorageGraph"
            WHERE "userStorageId" = $1
        """
        groups_query = """
            SELECT "groupIndex", "communityId", "pageStart", "pageEnd",
                   "pageRanges", "chunkIds", "estimatedTokens", "charCount",
                   weight, summary, metadata
            FROM "UserStorageGraphGroup"
            WHERE "userStorageId" = $1
            ORDER BY "groupIndex" ASC
        """

        async with pool.acquire() as conn:
            graph_row = await conn.fetchrow(query, user_storage_id)
            if graph_row is None:
                return None

            group_rows = await conn.fetch(groups_query, user_storage_id)
            return {
                'graph_id': graph_row['id'],
                'graph_version': graph_row['graphVersion'],
                'chunk_signature': graph_row['chunkSignature'],
                'status': graph_row['status'],
                'total_chunks': graph_row['totalChunks'],
                'total_edges': graph_row['totalEdges'],
                'total_communities': graph_row['totalCommunities'],
                'total_groups': graph_row['totalGroups'],
                'metadata': graph_row['metadata'] or {},
                'built_at': graph_row['builtAt'],
                'updated_at': graph_row['updatedAt'],
                'groups': [dict(row) for row in group_rows],
            }

    async def persist_graph_state(
        self,
        user_storage_id: str,
        *,
        chunk_signature: str,
        total_chunks: int,
        total_edges: int,
        total_communities: int,
        metadata: Dict[str, Any],
        groups: List[PersistedGraphGroup],
        graph_version: int = 1,
    ) -> None:
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            async with conn.transaction():
                graph_row = await conn.fetchrow(
                    'SELECT id FROM "UserStorageGraph" WHERE "userStorageId" = $1',
                    user_storage_id,
                )

                if graph_row is None:
                    graph_id_value = str(uuid4())
                    graph_id = await conn.fetchval(
                        """
                        INSERT INTO "UserStorageGraph" (
                            id, "userStorageId", "graphVersion", "chunkSignature", status,
                            "totalChunks", "totalEdges", "totalCommunities", "totalGroups",
                            metadata, "builtAt", "updatedAt"
                        ) VALUES (
                            $1, $2, $3, $4, 'READY',
                            $5, $6, $7, $8, $9::jsonb, NOW(), NOW()
                        )
                        RETURNING id
                        """,
                        graph_id_value,
                        user_storage_id,
                        graph_version,
                        chunk_signature,
                        total_chunks,
                        total_edges,
                        total_communities,
                        len(groups),
                        json.dumps(metadata),
                    )
                else:
                    graph_id = graph_row['id']
                    await conn.execute(
                        """
                        UPDATE "UserStorageGraph"
                        SET "graphVersion" = $2,
                            "chunkSignature" = $3,
                            status = 'READY',
                            "totalChunks" = $4,
                            "totalEdges" = $5,
                            "totalCommunities" = $6,
                            "totalGroups" = $7,
                            metadata = $8::jsonb,
                            "builtAt" = NOW(),
                            "updatedAt" = NOW()
                        WHERE "userStorageId" = $1
                        """,
                        user_storage_id,
                        graph_version,
                        chunk_signature,
                        total_chunks,
                        total_edges,
                        total_communities,
                        len(groups),
                        json.dumps(metadata),
                    )
                    await conn.execute(
                        'DELETE FROM "UserStorageGraphGroup" WHERE "graphId" = $1',
                        graph_id,
                    )

                for group in groups:
                    group_id_value = str(uuid4())
                    await conn.execute(
                        """
                        INSERT INTO "UserStorageGraphGroup" (
                            id, "graphId", "userStorageId", "groupIndex", "communityId",
                            "pageStart", "pageEnd", "pageRanges", "chunkIds",
                            "estimatedTokens", "charCount", weight, summary, metadata,
                            "createdAt", "updatedAt"
                        ) VALUES (
                            $1, $2, $3, $4, $5,
                            $6, $7, $8::jsonb, $9::jsonb,
                            $10, $11, $12, $13, $14::jsonb,
                            NOW(), NOW()
                        )
                        """,
                        group_id_value,
                        graph_id,
                        user_storage_id,
                        group.group_index,
                        group.community_id,
                        group.page_start,
                        group.page_end,
                        json.dumps(group.page_ranges),
                        json.dumps(group.chunk_ids),
                        group.estimated_tokens,
                        group.char_count,
                        group.weight,
                        group.summary,
                        json.dumps(group.metadata),
                    )

                logger.info(
                    'Persisted graph metadata to DB for user_storage_id=%s groups=%s chunks=%s edges=%s communities=%s',
                    user_storage_id,
                    len(groups),
                    total_chunks,
                    total_edges,
                    total_communities,
                )

    async def delete_graph_state(self, user_storage_id: str) -> None:
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                'DELETE FROM "UserStorageGraph" WHERE "userStorageId" = $1',
                user_storage_id,
            )

    async def ensure_graph_schema(self) -> None:
        pool = await self._get_pool()
        statements = [
            """
            CREATE TABLE IF NOT EXISTS "UserStorageGraph" (
                id TEXT PRIMARY KEY,
                "userStorageId" TEXT UNIQUE NOT NULL REFERENCES "UserStorage"(id) ON DELETE CASCADE,
                "graphVersion" INTEGER NOT NULL DEFAULT 1,
                "chunkSignature" TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'READY',
                "totalChunks" INTEGER NOT NULL DEFAULT 0,
                "totalEdges" INTEGER NOT NULL DEFAULT 0,
                "totalCommunities" INTEGER NOT NULL DEFAULT 0,
                "totalGroups" INTEGER NOT NULL DEFAULT 0,
                metadata JSONB,
                "builtAt" TIMESTAMP NOT NULL DEFAULT NOW(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS "UserStorageGraphGroup" (
                id TEXT PRIMARY KEY,
                "graphId" TEXT NOT NULL REFERENCES "UserStorageGraph"(id) ON DELETE CASCADE,
                "userStorageId" TEXT NOT NULL REFERENCES "UserStorage"(id) ON DELETE CASCADE,
                "groupIndex" INTEGER NOT NULL,
                "communityId" INTEGER,
                "pageStart" INTEGER,
                "pageEnd" INTEGER,
                "pageRanges" JSONB NOT NULL,
                "chunkIds" JSONB NOT NULL,
                "estimatedTokens" INTEGER NOT NULL DEFAULT 0,
                "charCount" INTEGER NOT NULL DEFAULT 0,
                weight DOUBLE PRECISION NOT NULL DEFAULT 1,
                summary TEXT,
                metadata JSONB,
                "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
            )
            """,
            'CREATE UNIQUE INDEX IF NOT EXISTS "UserStorageGraphGroup_graphId_groupIndex_key" ON "UserStorageGraphGroup"("graphId", "groupIndex")',
            'CREATE INDEX IF NOT EXISTS "UserStorageGraphGroup_userStorageId_groupIndex_idx" ON "UserStorageGraphGroup"("userStorageId", "groupIndex")',
            'CREATE INDEX IF NOT EXISTS "UserStorageGraph_status_idx" ON "UserStorageGraph"(status)',
        ]

        async with pool.acquire() as conn:
            for statement in statements:
                await conn.execute(statement)

        logger.info('Ensured UserStorageGraph and UserStorageGraphGroup tables exist')


graph_storage_service = GraphStorageService()
