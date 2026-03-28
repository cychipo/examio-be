from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional

import asyncpg

logger = logging.getLogger(__name__)

_QUERY_STOPWORDS = {
    'la',
    'gi',
    'the',
    'nao',
    'cach',
    'cho',
    'mot',
    'nhung',
    'voi',
    'and',
    'the',
    'for',
    'with',
}


def _normalize_timestamp(value: Any) -> Any:
    if value is None:
        return value
    if isinstance(value, datetime):
        if value.tzinfo is not None:
            return value.astimezone(timezone.utc).replace(tzinfo=None)
        return value
    if isinstance(value, str):
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is not None:
            return parsed.astimezone(timezone.utc).replace(tzinfo=None)
        return parsed
    return value


def _extract_query_entities(query_text: str) -> list[str]:
    tokens = re.findall(r'[A-Za-z0-9_]{3,}', query_text.lower())
    return [token for token in tokens if token not in _QUERY_STOPWORDS][:8]


@dataclass
class TutorRetrievedChunk:
    chunk_id: str
    document_id: str
    dataset_version: str
    content: str
    content_type: str
    language: str
    topic: Optional[str]
    difficulty: Optional[str]
    source_path: str
    title: str
    chunk_index: int
    similarity_score: float


@dataclass
class TutorGraphFact:
    entity_name: str
    entity_type: str
    relation_type: Optional[str]
    related_entity_name: Optional[str]
    weight: float


class TutorStorageService:
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
            logger.info('PostgreSQL connection pool created for TutorStorageService')

        return self._pool

    async def ensure_schema(self) -> None:
        pool = await self._get_pool()
        statements = [
            'CREATE EXTENSION IF NOT EXISTS vector',
            """
            CREATE TABLE IF NOT EXISTS \"TutorIngestJob\" (
                id TEXT PRIMARY KEY,
                \"datasetVersion\" TEXT NOT NULL,
                status TEXT NOT NULL,
                \"sourcePath\" TEXT NOT NULL,
                \"triggeredBy\" TEXT NOT NULL,
                \"courseCode\" TEXT NOT NULL,
                language TEXT,
                topic TEXT,
                difficulty TEXT,
                \"reindexMode\" TEXT NOT NULL,
                \"licenseTag\" TEXT,
                \"dryRun\" BOOLEAN NOT NULL DEFAULT FALSE,
                summary JSONB NOT NULL DEFAULT '{}'::jsonb,
                warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
                errors JSONB NOT NULL DEFAULT '[]'::jsonb,
                \"createdAt\" TIMESTAMP NOT NULL DEFAULT NOW(),
                \"startedAt\" TIMESTAMP,
                \"finishedAt\" TIMESTAMP
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS \"TutorKnowledgeDocument\" (
                id TEXT PRIMARY KEY,
                \"jobId\" TEXT NOT NULL REFERENCES \"TutorIngestJob\"(id) ON DELETE CASCADE,
                \"datasetVersion\" TEXT NOT NULL,
                \"sourcePath\" TEXT NOT NULL,
                \"sourceType\" TEXT NOT NULL,
                checksum TEXT NOT NULL,
                title TEXT NOT NULL,
                language TEXT NOT NULL,
                \"courseCode\" TEXT NOT NULL,
                topic TEXT,
                difficulty TEXT,
                \"licenseTag\" TEXT,
                status TEXT NOT NULL,
                \"chunkCount\" INTEGER NOT NULL DEFAULT 0,
                error TEXT,
                \"createdAt\" TIMESTAMP NOT NULL DEFAULT NOW(),
                \"updatedAt\" TIMESTAMP NOT NULL DEFAULT NOW()
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS \"TutorKnowledgeChunk\" (
                id TEXT PRIMARY KEY,
                \"documentId\" TEXT NOT NULL REFERENCES \"TutorKnowledgeDocument\"(id) ON DELETE CASCADE,
                \"jobId\" TEXT NOT NULL REFERENCES \"TutorIngestJob\"(id) ON DELETE CASCADE,
                \"datasetVersion\" TEXT NOT NULL,
                content TEXT NOT NULL,
                \"contentType\" TEXT NOT NULL,
                language TEXT NOT NULL,
                topic TEXT,
                difficulty TEXT,
                \"tokenCount\" INTEGER NOT NULL,
                checksum TEXT NOT NULL,
                \"chunkIndex\" INTEGER NOT NULL,
                \"startOffset\" INTEGER NOT NULL,
                \"endOffset\" INTEGER NOT NULL,
                \"embeddingModel\" TEXT,
                embeddings vector,
                metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                \"createdAt\" TIMESTAMP NOT NULL DEFAULT NOW(),
                \"updatedAt\" TIMESTAMP NOT NULL DEFAULT NOW()
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS \"TutorGraphEntity\" (
                id TEXT PRIMARY KEY,
                \"datasetVersion\" TEXT NOT NULL,
                \"chunkId\" TEXT NOT NULL REFERENCES \"TutorKnowledgeChunk\"(id) ON DELETE CASCADE,
                \"documentId\" TEXT NOT NULL REFERENCES \"TutorKnowledgeDocument\"(id) ON DELETE CASCADE,
                \"entityType\" TEXT NOT NULL,
                name TEXT NOT NULL,
                \"canonicalName\" TEXT NOT NULL,
                language TEXT NOT NULL,
                properties JSONB NOT NULL DEFAULT '{}'::jsonb,
                \"createdAt\" TIMESTAMP NOT NULL DEFAULT NOW(),
                \"updatedAt\" TIMESTAMP NOT NULL DEFAULT NOW()
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS \"TutorGraphRelation\" (
                id TEXT PRIMARY KEY,
                \"datasetVersion\" TEXT NOT NULL,
                \"fromEntityId\" TEXT NOT NULL REFERENCES \"TutorGraphEntity\"(id) ON DELETE CASCADE,
                \"toEntityId\" TEXT NOT NULL REFERENCES \"TutorGraphEntity\"(id) ON DELETE CASCADE,
                \"relationType\" TEXT NOT NULL,
                weight DOUBLE PRECISION NOT NULL DEFAULT 1,
                \"evidenceChunkId\" TEXT NOT NULL REFERENCES \"TutorKnowledgeChunk\"(id) ON DELETE CASCADE,
                \"createdAt\" TIMESTAMP NOT NULL DEFAULT NOW(),
                \"updatedAt\" TIMESTAMP NOT NULL DEFAULT NOW()
            )
            """,
            'CREATE INDEX IF NOT EXISTS "TutorIngestJob_courseCode_idx" ON "TutorIngestJob"("courseCode")',
            'CREATE INDEX IF NOT EXISTS "TutorIngestJob_status_idx" ON "TutorIngestJob"(status)',
            'CREATE INDEX IF NOT EXISTS "TutorKnowledgeDocument_jobId_idx" ON "TutorKnowledgeDocument"("jobId")',
            'CREATE INDEX IF NOT EXISTS "TutorKnowledgeDocument_dataset_course_idx" ON "TutorKnowledgeDocument"("datasetVersion", "courseCode")',
            'CREATE INDEX IF NOT EXISTS "TutorKnowledgeChunk_jobId_idx" ON "TutorKnowledgeChunk"("jobId")',
            'CREATE INDEX IF NOT EXISTS "TutorKnowledgeChunk_dataset_idx" ON "TutorKnowledgeChunk"("datasetVersion")',
            'CREATE INDEX IF NOT EXISTS "TutorKnowledgeChunk_language_topic_idx" ON "TutorKnowledgeChunk"(language, topic)',
            'CREATE INDEX IF NOT EXISTS "TutorGraphEntity_chunkId_idx" ON "TutorGraphEntity"("chunkId")',
            'CREATE INDEX IF NOT EXISTS "TutorGraphEntity_canonicalName_idx" ON "TutorGraphEntity"("canonicalName")',
            'CREATE INDEX IF NOT EXISTS "TutorGraphRelation_fromEntityId_idx" ON "TutorGraphRelation"("fromEntityId")',
        ]

        async with pool.acquire() as conn:
            for statement in statements:
                await conn.execute(statement)

        logger.info('Ensured tutor ingestion tables exist')

    async def create_job(self, payload: dict[str, Any]) -> None:
        pool = await self._get_pool()
        query = """
            INSERT INTO "TutorIngestJob" (
                id, "datasetVersion", status, "sourcePath", "triggeredBy", "courseCode",
                language, topic, difficulty, "reindexMode", "licenseTag", "dryRun",
                summary, warnings, errors, "createdAt", "startedAt", "finishedAt"
            ) VALUES (
                $1, $2, $3, $4, $5, $6,
                $7, $8, $9, $10, $11, $12,
                $13::jsonb, $14::jsonb, $15::jsonb, $16, $17, $18
            )
        """
        async with pool.acquire() as conn:
            await conn.execute(
                query,
                payload['jobId'],
                payload['datasetVersion'],
                payload['status'],
                payload['sourcePath'],
                payload['triggeredBy'],
                payload['courseCode'],
                payload['language'],
                payload['topic'],
                payload['difficulty'],
                payload['reindexMode'],
                payload['licenseTag'],
                payload['dryRun'],
                json.dumps(payload['summary']),
                json.dumps(payload['warnings']),
                json.dumps(payload['errors']),
                _normalize_timestamp(payload['createdAt']),
                _normalize_timestamp(payload['startedAt']),
                _normalize_timestamp(payload['finishedAt']),
            )

    async def update_job(self, payload: dict[str, Any]) -> None:
        pool = await self._get_pool()
        query = """
            UPDATE "TutorIngestJob"
            SET "datasetVersion" = $2,
                status = $3,
                "sourcePath" = $4,
                "triggeredBy" = $5,
                "courseCode" = $6,
                language = $7,
                topic = $8,
                difficulty = $9,
                "reindexMode" = $10,
                "licenseTag" = $11,
                "dryRun" = $12,
                summary = $13::jsonb,
                warnings = $14::jsonb,
                errors = $15::jsonb,
                "startedAt" = $16,
                "finishedAt" = $17
            WHERE id = $1
        """
        async with pool.acquire() as conn:
            await conn.execute(
                query,
                payload['jobId'],
                payload['datasetVersion'],
                payload['status'],
                payload['sourcePath'],
                payload['triggeredBy'],
                payload['courseCode'],
                payload['language'],
                payload['topic'],
                payload['difficulty'],
                payload['reindexMode'],
                payload['licenseTag'],
                payload['dryRun'],
                json.dumps(payload['summary']),
                json.dumps(payload['warnings']),
                json.dumps(payload['errors']),
                _normalize_timestamp(payload['startedAt']),
                _normalize_timestamp(payload['finishedAt']),
            )

    async def upsert_document(self, payload: dict[str, Any], job_id: str, dataset_version: str) -> None:
        pool = await self._get_pool()
        query = """
            INSERT INTO "TutorKnowledgeDocument" (
                id, "jobId", "datasetVersion", "sourcePath", "sourceType", checksum, title,
                language, "courseCode", topic, difficulty, "licenseTag", status,
                "chunkCount", error, "createdAt", "updatedAt"
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7,
                $8, $9, $10, $11, $12, $13,
                $14, $15, NOW(), NOW()
            )
            ON CONFLICT (id) DO UPDATE SET
                "jobId" = EXCLUDED."jobId",
                "datasetVersion" = EXCLUDED."datasetVersion",
                "sourcePath" = EXCLUDED."sourcePath",
                "sourceType" = EXCLUDED."sourceType",
                checksum = EXCLUDED.checksum,
                title = EXCLUDED.title,
                language = EXCLUDED.language,
                "courseCode" = EXCLUDED."courseCode",
                topic = EXCLUDED.topic,
                difficulty = EXCLUDED.difficulty,
                "licenseTag" = EXCLUDED."licenseTag",
                status = EXCLUDED.status,
                "chunkCount" = EXCLUDED."chunkCount",
                error = EXCLUDED.error,
                "updatedAt" = NOW()
        """
        async with pool.acquire() as conn:
            await conn.execute(
                query,
                payload['document_id'],
                job_id,
                dataset_version,
                payload['source_path'],
                payload['source_type'],
                payload['checksum'],
                payload['title'],
                payload['language'],
                payload['course_code'],
                payload['topic'],
                payload['difficulty'],
                payload['license_tag'],
                payload['status'],
                payload['chunk_count'],
                payload['error'],
            )

    async def replace_document_chunks(
        self,
        *,
        job_id: str,
        dataset_version: str,
        document_id: str,
        embedding_model: Optional[str],
        chunks: list[dict[str, Any]],
        embeddings: list[list[float]],
    ) -> None:
        pool = await self._get_pool()
        delete_query = 'DELETE FROM "TutorKnowledgeChunk" WHERE "documentId" = $1'
        insert_query = """
            INSERT INTO "TutorKnowledgeChunk" (
                id, "documentId", "jobId", "datasetVersion", content, "contentType", language,
                topic, difficulty, "tokenCount", checksum, "chunkIndex", "startOffset", "endOffset",
                "embeddingModel", embeddings, metadata, "createdAt", "updatedAt"
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7,
                $8, $9, $10, $11, $12, $13, $14,
                $15, $16::vector, $17::jsonb, NOW(), NOW()
            )
        """
        records = [
            (
                chunk['chunk_id'],
                document_id,
                job_id,
                dataset_version,
                chunk['content'],
                chunk['content_type'],
                chunk['language'],
                chunk['topic'],
                chunk['difficulty'],
                chunk['token_count'],
                chunk['checksum'],
                chunk['chunk_index'],
                chunk['start_offset'],
                chunk['end_offset'],
                embedding_model,
                f"[{','.join(str(v) for v in embeddings[index])}]",
                json.dumps({
                    'documentId': document_id,
                    'chunkIndex': chunk['chunk_index'],
                }),
            )
            for index, chunk in enumerate(chunks)
        ]

        async with pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute(delete_query, document_id)
                if records:
                    await conn.executemany(insert_query, records)

    async def replace_chunk_graph(
        self,
        *,
        dataset_version: str,
        document_id: str,
        chunk_id: str,
        entities: list[dict[str, Any]],
        relations: list[dict[str, Any]],
    ) -> None:
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute(
                    'DELETE FROM "TutorGraphRelation" WHERE "evidenceChunkId" = $1',
                    chunk_id,
                )
                await conn.execute(
                    'DELETE FROM "TutorGraphEntity" WHERE "chunkId" = $1',
                    chunk_id,
                )

                entity_id_by_name: dict[str, str] = {}
                for entity in entities:
                    entity_id_by_name[entity['canonicalName']] = entity['entityId']
                    await conn.execute(
                        """
                        INSERT INTO "TutorGraphEntity" (
                            id, "datasetVersion", "chunkId", "documentId", "entityType", name,
                            "canonicalName", language, properties, "createdAt", "updatedAt"
                        ) VALUES (
                            $1, $2, $3, $4, $5, $6,
                            $7, $8, $9::jsonb, NOW(), NOW()
                        )
                        """,
                        entity['entityId'],
                        dataset_version,
                        chunk_id,
                        document_id,
                        entity['entityType'],
                        entity['name'],
                        entity['canonicalName'],
                        entity['language'],
                        json.dumps(entity['properties']),
                    )

                for relation in relations:
                    from_entity_id = entity_id_by_name.get(relation['fromCanonicalName'])
                    to_entity_id = entity_id_by_name.get(relation['toCanonicalName'])
                    if not from_entity_id or not to_entity_id:
                        continue
                    await conn.execute(
                        """
                        INSERT INTO "TutorGraphRelation" (
                            id, "datasetVersion", "fromEntityId", "toEntityId", "relationType",
                            weight, "evidenceChunkId", "createdAt", "updatedAt"
                        ) VALUES (
                            $1, $2, $3, $4, $5,
                            $6, $7, NOW(), NOW()
                        )
                        """,
                        relation['relationId'],
                        dataset_version,
                        from_entity_id,
                        to_entity_id,
                        relation['relationType'],
                        relation['weight'],
                        chunk_id,
                    )

    async def get_graph_facts(
        self,
        *,
        chunk_ids: list[str],
        limit: int = 20,
    ) -> list[TutorGraphFact]:
        if not chunk_ids:
            return []

        pool = await self._get_pool()
        query = """
            SELECT
                source.name AS entity_name,
                source."entityType" AS entity_type,
                rel."relationType" AS relation_type,
                target.name AS related_entity_name,
                COALESCE(rel.weight, 1) AS weight
            FROM "TutorGraphEntity" source
            LEFT JOIN "TutorGraphRelation" rel ON rel."fromEntityId" = source.id
            LEFT JOIN "TutorGraphEntity" target ON target.id = rel."toEntityId"
            WHERE source."chunkId" = ANY($1::text[])
            ORDER BY weight DESC, source.name ASC
            LIMIT $2
        """
        async with pool.acquire() as conn:
            rows = await conn.fetch(query, chunk_ids, limit)

        return [
            TutorGraphFact(
                entity_name=row['entity_name'],
                entity_type=row['entity_type'],
                relation_type=row['relation_type'],
                related_entity_name=row['related_entity_name'],
                weight=row['weight'],
            )
            for row in rows
        ]

    async def get_graph_neighbors(
        self,
        *,
        chunk_ids: list[str],
        limit: int = 20,
    ) -> list[TutorGraphFact]:
        if not chunk_ids:
            return []

        pool = await self._get_pool()
        query = """
            WITH seed_entities AS (
                SELECT id, name, "entityType"
                FROM "TutorGraphEntity"
                WHERE "chunkId" = ANY($1::text[])
            )
            SELECT
                seed.name AS entity_name,
                seed."entityType" AS entity_type,
                rel."relationType" AS relation_type,
                neighbor.name AS related_entity_name,
                COALESCE(rel.weight, 1) AS weight
            FROM seed_entities seed
            INNER JOIN "TutorGraphRelation" rel ON rel."fromEntityId" = seed.id OR rel."toEntityId" = seed.id
            INNER JOIN "TutorGraphEntity" neighbor
                ON (neighbor.id = rel."toEntityId" AND neighbor.id <> seed.id)
                OR (neighbor.id = rel."fromEntityId" AND neighbor.id <> seed.id)
            ORDER BY weight DESC, seed.name ASC
            LIMIT $2
        """
        async with pool.acquire() as conn:
            rows = await conn.fetch(query, chunk_ids, limit)

        return [
            TutorGraphFact(
                entity_name=row['entity_name'],
                entity_type=row['entity_type'],
                relation_type=row['relation_type'],
                related_entity_name=row['related_entity_name'],
                weight=row['weight'],
            )
            for row in rows
        ]

    async def get_graph_snapshot_by_job(self, job_id: str) -> dict[str, Any]:
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            documents = await conn.fetch(
                'SELECT id, title, "sourcePath" FROM "TutorKnowledgeDocument" WHERE "jobId" = $1 ORDER BY "createdAt" ASC',
                job_id,
            )
            entities = await conn.fetch(
                """
                SELECT e.id, e."chunkId", e."documentId", e."entityType", e.name, e."canonicalName", e.language, e.properties
                FROM "TutorGraphEntity" e
                INNER JOIN "TutorKnowledgeDocument" d ON d.id = e."documentId"
                WHERE d."jobId" = $1
                ORDER BY e.name ASC
                LIMIT 200
                """,
                job_id,
            )
            relations = await conn.fetch(
                """
                SELECT r.id, r."relationType", r.weight, r."evidenceChunkId",
                       src.name AS from_name, tgt.name AS to_name
                FROM "TutorGraphRelation" r
                INNER JOIN "TutorGraphEntity" src ON src.id = r."fromEntityId"
                INNER JOIN "TutorGraphEntity" tgt ON tgt.id = r."toEntityId"
                INNER JOIN "TutorKnowledgeDocument" d ON d.id = src."documentId"
                WHERE d."jobId" = $1
                ORDER BY r.weight DESC, src.name ASC
                LIMIT 200
                """,
                job_id,
            )

        return {
            'jobId': job_id,
            'documents': [dict(row) for row in documents],
            'entities': [dict(row) for row in entities],
            'relations': [dict(row) for row in relations],
        }

    async def get_graph_snapshot_by_document(self, document_id: str) -> dict[str, Any]:
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            document = await conn.fetchrow(
                'SELECT id, title, "sourcePath", "jobId" FROM "TutorKnowledgeDocument" WHERE id = $1',
                document_id,
            )
            if document is None:
                return {}

            entities = await conn.fetch(
                'SELECT id, "chunkId", "entityType", name, "canonicalName", language, properties FROM "TutorGraphEntity" WHERE "documentId" = $1 ORDER BY name ASC LIMIT 200',
                document_id,
            )
            relations = await conn.fetch(
                """
                SELECT r.id, r."relationType", r.weight, r."evidenceChunkId",
                       src.name AS from_name, tgt.name AS to_name
                FROM "TutorGraphRelation" r
                INNER JOIN "TutorGraphEntity" src ON src.id = r."fromEntityId"
                INNER JOIN "TutorGraphEntity" tgt ON tgt.id = r."toEntityId"
                WHERE src."documentId" = $1
                ORDER BY r.weight DESC, src.name ASC
                LIMIT 200
                """,
                document_id,
            )

        return {
            'document': dict(document),
            'entities': [dict(row) for row in entities],
            'relations': [dict(row) for row in relations],
        }

    async def fetch_job(self, job_id: str) -> Optional[dict[str, Any]]:
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                'SELECT * FROM "TutorIngestJob" WHERE id = $1',
                job_id,
            )
            if row is None:
                return None

            documents = await conn.fetch(
                'SELECT * FROM "TutorKnowledgeDocument" WHERE "jobId" = $1 ORDER BY "createdAt" ASC',
                job_id,
            )
            preview_chunks = await conn.fetch(
                'SELECT * FROM "TutorKnowledgeChunk" WHERE "jobId" = $1 ORDER BY "chunkIndex" ASC LIMIT 10',
                job_id,
            )

        return self._map_job_row(row, documents, preview_chunks)

    async def list_jobs(self, limit: int = 20) -> list[dict[str, Any]]:
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                'SELECT * FROM "TutorIngestJob" ORDER BY "createdAt" DESC LIMIT $1',
                limit,
            )

        return [self._map_job_row(row, [], []) for row in rows]

    async def delete_job_data(self, job_id: str) -> None:
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            await conn.execute('DELETE FROM "TutorIngestJob" WHERE id = $1', job_id)

    async def delete_jobs_by_trigger(self, trigger: str) -> None:
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                'DELETE FROM "TutorIngestJob" WHERE "triggeredBy" LIKE $1',
                trigger,
            )

    async def search_chunks(
        self,
        *,
        query_embedding: list[float],
        course_code: str,
        language: Optional[str],
        topic: Optional[str],
        difficulty: Optional[str],
        top_k: int,
    ) -> list[TutorRetrievedChunk]:
        pool = await self._get_pool()
        filters = ['doc."courseCode" = $2']
        params: list[Any] = [f"[{','.join(str(v) for v in query_embedding)}]", course_code]
        next_index = 3

        if language:
            filters.append(f'chunk.language = ${next_index}')
            params.append(language)
            next_index += 1
        if topic:
            filters.append(f'chunk.topic = ${next_index}')
            params.append(topic)
            next_index += 1
        if difficulty:
            filters.append(f'chunk.difficulty = ${next_index}')
            params.append(difficulty)
            next_index += 1

        params.append(top_k)
        where_clause = ' AND '.join(filters)
        query = f"""
            SELECT
                chunk.id,
                chunk."documentId",
                chunk."datasetVersion",
                chunk.content,
                chunk."contentType",
                chunk.language,
                chunk.topic,
                chunk.difficulty,
                doc."sourcePath",
                doc.title,
                chunk."chunkIndex",
                1 - (chunk.embeddings <=> $1::vector) as similarity_score
            FROM "TutorKnowledgeChunk" chunk
            INNER JOIN "TutorKnowledgeDocument" doc ON doc.id = chunk."documentId"
            WHERE {where_clause}
            ORDER BY chunk.embeddings <=> $1::vector ASC
            LIMIT ${next_index}
        """

        async with pool.acquire() as conn:
            rows = await conn.fetch(query, *params)

        return [
            TutorRetrievedChunk(
                chunk_id=row['id'],
                document_id=row['documentId'],
                dataset_version=row['datasetVersion'],
                content=row['content'],
                content_type=row['contentType'],
                language=row['language'],
                topic=row['topic'],
                difficulty=row['difficulty'],
                source_path=row['sourcePath'],
                title=row['title'],
                chunk_index=row['chunkIndex'],
                similarity_score=row['similarity_score'],
            )
            for row in rows
        ]

    async def search_chunks_hybrid(
        self,
        *,
        query_embedding: list[float],
        course_code: str,
        language: Optional[str],
        topic: Optional[str],
        difficulty: Optional[str],
        top_k: int,
        query_text: str,
    ) -> list[TutorRetrievedChunk]:
        vector_hits = await self.search_chunks(
            query_embedding=query_embedding,
            course_code=course_code,
            language=language,
            topic=topic,
            difficulty=difficulty,
            top_k=max(top_k, 6),
        )

        graph_hits = await self.search_chunks_by_entities(
            query_text=query_text,
            course_code=course_code,
            language=language,
            topic=topic,
            difficulty=difficulty,
            limit=max(top_k, 6),
        )

        ranked: dict[str, TutorRetrievedChunk] = {}
        for item in vector_hits:
            ranked[item.chunk_id] = item

        for item in graph_hits:
            current = ranked.get(item.chunk_id)
            if current is None or item.similarity_score > current.similarity_score:
                ranked[item.chunk_id] = item

        merged = sorted(ranked.values(), key=lambda item: item.similarity_score, reverse=True)
        return merged[:top_k]

    async def search_chunks_by_entities(
        self,
        *,
        query_text: str,
        course_code: str,
        language: Optional[str],
        topic: Optional[str],
        difficulty: Optional[str],
        limit: int,
    ) -> list[TutorRetrievedChunk]:
        entity_tokens = _extract_query_entities(query_text)
        if not entity_tokens:
            return []

        pool = await self._get_pool()
        filters = ['doc."courseCode" = $1']
        params: list[Any] = [course_code]
        next_index = 2

        if language:
            filters.append(f'chunk.language = ${next_index}')
            params.append(language)
            next_index += 1
        if topic:
            filters.append(f'chunk.topic = ${next_index}')
            params.append(topic)
            next_index += 1
        if difficulty:
            filters.append(f'chunk.difficulty = ${next_index}')
            params.append(difficulty)
            next_index += 1

        filters.append(f'e."canonicalName" = ANY(${next_index}::text[])')
        params.append(entity_tokens)
        next_index += 1
        params.append(limit)

        where_clause = ' AND '.join(filters)
        query = f"""
            SELECT
                chunk.id,
                chunk."documentId",
                chunk."datasetVersion",
                chunk.content,
                chunk."contentType",
                chunk.language,
                chunk.topic,
                chunk.difficulty,
                doc."sourcePath",
                doc.title,
                chunk."chunkIndex",
                0.95::double precision AS similarity_score
            FROM "TutorGraphEntity" e
            INNER JOIN "TutorKnowledgeChunk" chunk ON chunk.id = e."chunkId"
            INNER JOIN "TutorKnowledgeDocument" doc ON doc.id = chunk."documentId"
            WHERE {where_clause}
            ORDER BY chunk."updatedAt" DESC
            LIMIT ${next_index}
        """

        async with pool.acquire() as conn:
            rows = await conn.fetch(query, *params)

        return [
            TutorRetrievedChunk(
                chunk_id=row['id'],
                document_id=row['documentId'],
                dataset_version=row['datasetVersion'],
                content=row['content'],
                content_type=row['contentType'],
                language=row['language'],
                topic=row['topic'],
                difficulty=row['difficulty'],
                source_path=row['sourcePath'],
                title=row['title'],
                chunk_index=row['chunkIndex'],
                similarity_score=row['similarity_score'],
            )
            for row in rows
        ]

    def _map_job_row(
        self,
        row: asyncpg.Record,
        documents: list[asyncpg.Record],
        preview_chunks: list[asyncpg.Record],
    ) -> dict[str, Any]:
        return {
            'jobId': row['id'],
            'datasetVersion': row['datasetVersion'],
            'status': row['status'],
            'sourcePath': row['sourcePath'],
            'triggeredBy': row['triggeredBy'],
            'courseCode': row['courseCode'],
            'language': row['language'],
            'topic': row['topic'],
            'difficulty': row['difficulty'],
            'reindexMode': row['reindexMode'],
            'licenseTag': row['licenseTag'],
            'dryRun': row['dryRun'],
            'createdAt': row['createdAt'].isoformat() if row['createdAt'] else None,
            'startedAt': row['startedAt'].isoformat() if row['startedAt'] else None,
            'finishedAt': row['finishedAt'].isoformat() if row['finishedAt'] else None,
            'summary': row['summary'] or {},
            'warnings': row['warnings'] or [],
            'errors': row['errors'] or [],
            'documents': [
                {
                    'document_id': item['id'],
                    'source_path': item['sourcePath'],
                    'source_type': item['sourceType'],
                    'checksum': item['checksum'],
                    'title': item['title'],
                    'language': item['language'],
                    'course_code': item['courseCode'],
                    'topic': item['topic'],
                    'difficulty': item['difficulty'],
                    'license_tag': item['licenseTag'],
                    'status': item['status'],
                    'chunk_count': item['chunkCount'],
                    'error': item['error'],
                }
                for item in documents
            ],
            'previewChunks': [
                {
                    'chunk_id': item['id'],
                    'document_id': item['documentId'],
                    'chunk_index': item['chunkIndex'],
                    'content': item['content'],
                    'content_type': item['contentType'],
                    'language': item['language'],
                    'topic': item['topic'],
                    'difficulty': item['difficulty'],
                    'token_count': item['tokenCount'],
                    'checksum': item['checksum'],
                    'start_offset': item['startOffset'],
                    'end_offset': item['endOffset'],
                }
                for item in preview_chunks
            ],
        }


tutor_storage_service = TutorStorageService()
