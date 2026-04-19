from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any, Optional

import asyncpg


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_timestamp(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, str):
        value = datetime.fromisoformat(value)
    if isinstance(value, datetime) and value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def _normalize_metadata(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


class StudentProgrammingChatService:
    _instance = None
    _pool: Optional[asyncpg.Pool] = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    async def _get_pool(self) -> asyncpg.Pool:
        if self._pool is None or self._pool._closed:
            self._pool = await asyncpg.create_pool(os.environ['DATABASE_URL'], min_size=1, max_size=10)
        return self._pool

    async def ensure_schema(self) -> None:
        pool = await self._get_pool()
        statements = [
            '''
            CREATE TABLE IF NOT EXISTS "StudentProgrammingChatSession" (
                id TEXT PRIMARY KEY,
                "userId" TEXT NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
            )
            ''',
            '''
            CREATE TABLE IF NOT EXISTS "StudentProgrammingChatMessage" (
                id TEXT PRIMARY KEY,
                "sessionId" TEXT NOT NULL REFERENCES "StudentProgrammingChatSession"(id) ON DELETE CASCADE,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
            )
            ''',
            '''
            CREATE TABLE IF NOT EXISTS "StudentProgrammingEvaluationJob" (
                id TEXT PRIMARY KEY,
                "userId" TEXT NOT NULL,
                "sessionId" TEXT NOT NULL REFERENCES "StudentProgrammingChatSession"(id) ON DELETE CASCADE,
                "messageId" TEXT NOT NULL REFERENCES "StudentProgrammingChatMessage"(id) ON DELETE CASCADE,
                status TEXT NOT NULL DEFAULT 'queued',
                score INTEGER,
                language TEXT,
                rationale TEXT,
                passed INTEGER NOT NULL DEFAULT 0,
                total INTEGER NOT NULL DEFAULT 0,
                "executionTimeMs" DOUBLE PRECISION NOT NULL DEFAULT 0,
                "stderr" TEXT,
                "stdout" TEXT,
                "testCode" TEXT,
                "modelUsed" TEXT,
                "errorMessage" TEXT,
                metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
                "completedAt" TIMESTAMP
            )
            ''',
            'CREATE INDEX IF NOT EXISTS "StudentProgrammingChatSession_userId_idx" ON "StudentProgrammingChatSession"("userId", "updatedAt" DESC)',
            'CREATE INDEX IF NOT EXISTS "StudentProgrammingChatMessage_sessionId_idx" ON "StudentProgrammingChatMessage"("sessionId", "createdAt")',
            'CREATE INDEX IF NOT EXISTS "StudentProgrammingEvaluationJob_userId_idx" ON "StudentProgrammingEvaluationJob"("userId", "updatedAt" DESC)',
        ]
        async with pool.acquire() as conn:
            for statement in statements:
                await conn.execute(statement)

    async def list_sessions(self, user_id: str) -> list[dict[str, Any]]:
        pool = await self._get_pool()
        query = '''
            SELECT s.*, (
                SELECT content FROM "StudentProgrammingChatMessage" m
                WHERE m."sessionId" = s.id
                ORDER BY m."createdAt" DESC
                LIMIT 1
            ) AS "lastMessage",
            (
                SELECT COUNT(*) FROM "StudentProgrammingChatMessage" m
                WHERE m."sessionId" = s.id
            ) AS "messageCount"
            FROM "StudentProgrammingChatSession" s
            WHERE s."userId" = $1
            ORDER BY s."updatedAt" DESC
        '''
        async with pool.acquire() as conn:
            rows = await conn.fetch(query, user_id)
        return [self._map_session_row(row) for row in rows]

    async def create_session(self, payload: dict[str, Any]) -> dict[str, Any]:
        pool = await self._get_pool()
        query = '''
            INSERT INTO "StudentProgrammingChatSession" (id, "userId", title, "createdAt", "updatedAt")
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
        '''
        now = _utc_now().isoformat()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(query, payload['id'], payload['userId'], payload.get('title') or '', _normalize_timestamp(now), _normalize_timestamp(now))
        return self._map_session_row(row)

    async def update_session(self, session_id: str, user_id: str, title: str) -> dict[str, Any]:
        pool = await self._get_pool()
        query = '''
            UPDATE "StudentProgrammingChatSession"
            SET title = $3, "updatedAt" = $4
            WHERE id = $1 AND "userId" = $2
            RETURNING *
        '''
        async with pool.acquire() as conn:
            row = await conn.fetchrow(query, session_id, user_id, title, _normalize_timestamp(_utc_now().isoformat()))
        if row is None:
            raise ValueError('Student chat session not found')
        return self._map_session_row(row)

    async def delete_session(self, session_id: str, user_id: str) -> dict[str, Any]:
        pool = await self._get_pool()
        query = 'DELETE FROM "StudentProgrammingChatSession" WHERE id = $1 AND "userId" = $2 RETURNING id'
        async with pool.acquire() as conn:
            row = await conn.fetchrow(query, session_id, user_id)
        if row is None:
            raise ValueError('Student chat session not found')
        return {'success': True, 'sessionId': session_id}

    async def list_messages(self, session_id: str, user_id: str) -> list[dict[str, Any]]:
        await self._validate_owner(session_id, user_id)
        pool = await self._get_pool()
        query = 'SELECT * FROM "StudentProgrammingChatMessage" WHERE "sessionId" = $1 ORDER BY "createdAt" ASC'
        async with pool.acquire() as conn:
            rows = await conn.fetch(query, session_id)
        return [self._map_message_row(row) for row in rows]

    async def create_message(self, payload: dict[str, Any]) -> dict[str, Any]:
        await self._validate_owner(payload['sessionId'], payload['userId'])
        pool = await self._get_pool()
        query = '''
            INSERT INTO "StudentProgrammingChatMessage" (id, "sessionId", role, content, metadata, "createdAt")
            VALUES ($1, $2, $3, $4, $5::jsonb, $6)
            RETURNING *
        '''
        now = _utc_now().isoformat()
        async with pool.acquire() as conn:
            async with conn.transaction():
                row = await conn.fetchrow(
                    query,
                    payload['id'],
                    payload['sessionId'],
                    payload['role'],
                    payload['content'],
                    json.dumps(payload.get('metadata', {})),
                    _normalize_timestamp(now),
                )
                await conn.execute(
                    'UPDATE "StudentProgrammingChatSession" SET "updatedAt" = $2 WHERE id = $1',
                    payload['sessionId'],
                    _normalize_timestamp(now),
                )
        return self._map_message_row(row)

    async def create_evaluation_job(self, payload: dict[str, Any]) -> dict[str, Any]:
        await self._validate_owner(payload['sessionId'], payload['userId'])
        pool = await self._get_pool()
        query = '''
            INSERT INTO "StudentProgrammingEvaluationJob" (
                id, "userId", "sessionId", "messageId", status, metadata, "createdAt", "updatedAt"
            ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
            RETURNING *
        '''
        now = _normalize_timestamp(_utc_now().isoformat())
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                query,
                payload['id'],
                payload['userId'],
                payload['sessionId'],
                payload['messageId'],
                payload.get('status', 'queued'),
                json.dumps(payload.get('metadata', {})),
                now,
                now,
            )
        return self._map_evaluation_job_row(row)

    async def get_evaluation_job(self, job_id: str, user_id: str) -> dict[str, Any] | None:
        pool = await self._get_pool()
        query = 'SELECT * FROM "StudentProgrammingEvaluationJob" WHERE id = $1 AND ($2 = $3 OR "userId" = $2)'
        async with pool.acquire() as conn:
            row = await conn.fetchrow(query, job_id, user_id, '%')
        return self._map_evaluation_job_row(row) if row else None

    async def update_evaluation_job(self, job_id: str, user_id: str, updates: dict[str, Any]) -> dict[str, Any]:
        job = await self.get_evaluation_job(job_id, user_id)
        if job is None:
            raise ValueError('Student evaluation job not found')

        merged_metadata = {
            **_normalize_metadata(job.get('metadata')),
            **updates.get('metadata', {}),
        }
        if 'scorePhase' in updates:
            merged_metadata['scorePhase'] = updates.get('scorePhase')
        if 'isFinal' in updates:
            merged_metadata['isFinal'] = updates.get('isFinal')
        payload = {
            'status': updates.get('status', job['status']),
            'score': updates.get('score', job.get('score')),
            'language': updates.get('language', job.get('language')),
            'rationale': updates.get('rationale', job.get('rationale')),
            'passed': updates.get('passed', job.get('passed', 0)),
            'total': updates.get('total', job.get('total', 0)),
            'executionTimeMs': updates.get('executionTimeMs', job.get('executionTimeMs', 0)),
            'stderr': updates.get('stderr', job.get('stderr')),
            'stdout': updates.get('stdout', job.get('stdout')),
            'testCode': updates.get('testCode', job.get('testCode')),
            'modelUsed': updates.get('modelUsed', job.get('modelUsed')),
            'errorMessage': updates.get('errorMessage', job.get('errorMessage')),
            'metadata': merged_metadata,
            'completedAt': _normalize_timestamp(_utc_now().isoformat()) if updates.get('completedAt') or updates.get('status') in {'completed', 'failed'} else None,
        }
        pool = await self._get_pool()
        query = '''
            UPDATE "StudentProgrammingEvaluationJob"
            SET status = $3,
                score = $4,
                language = $5,
                rationale = $6,
                passed = $7,
                total = $8,
                "executionTimeMs" = $9,
                "stderr" = $10,
                "stdout" = $11,
                "testCode" = $12,
                "modelUsed" = $13,
                "errorMessage" = $14,
                metadata = $15::jsonb,
                "updatedAt" = $16,
                "completedAt" = COALESCE($17, "completedAt")
            WHERE id = $1 AND "userId" = $2
            RETURNING *
        '''
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                query,
                job_id,
                user_id,
                payload['status'],
                payload['score'],
                payload['language'],
                payload['rationale'],
                payload['passed'],
                payload['total'],
                payload['executionTimeMs'],
                payload['stderr'],
                payload['stdout'],
                payload['testCode'],
                payload['modelUsed'],
                payload['errorMessage'],
                json.dumps(payload['metadata']),
                _normalize_timestamp(_utc_now().isoformat()),
                payload['completedAt'],
            )
        return self._map_evaluation_job_row(row)

    async def attach_evaluation_to_message(
        self,
        *,
        session_id: str,
        message_id: str,
        user_id: str,
        evaluation: dict[str, Any],
        evaluation_job: dict[str, Any],
    ) -> dict[str, Any]:
        await self._validate_owner(session_id, user_id)
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                'SELECT * FROM "StudentProgrammingChatMessage" WHERE id = $1 AND "sessionId" = $2',
                message_id,
                session_id,
            )
            if row is None:
                raise ValueError('Student chat message not found')
            metadata = _normalize_metadata(row['metadata'])
            metadata['evaluation'] = evaluation
            metadata['evaluationJob'] = {
                'id': evaluation_job['id'],
                'status': evaluation_job['status'],
                'score': evaluation_job.get('score'),
                'scorePhase': evaluation_job.get('scorePhase'),
                'isFinal': evaluation_job.get('isFinal'),
            }
            updated = await conn.fetchrow(
                '''
                UPDATE "StudentProgrammingChatMessage"
                SET metadata = $3::jsonb
                WHERE id = $1 AND "sessionId" = $2
                RETURNING *
                ''',
                message_id,
                session_id,
                json.dumps(metadata),
            )
        return self._map_message_row(updated)

    async def _validate_owner(self, session_id: str, user_id: str) -> None:
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow('SELECT id FROM "StudentProgrammingChatSession" WHERE id = $1 AND "userId" = $2', session_id, user_id)
        if row is None:
            raise ValueError('Student chat session not found')

    def _map_session_row(self, row: asyncpg.Record) -> dict[str, Any]:
        return {
            'id': row['id'],
            'userId': row['userId'],
            'title': row['title'],
            'createdAt': row['createdAt'].isoformat() if row['createdAt'] else None,
            'updatedAt': row['updatedAt'].isoformat() if row['updatedAt'] else None,
            'lastMessage': row.get('lastMessage'),
            'messageCount': int(row.get('messageCount', 0) or 0),
        }

    def _map_message_row(self, row: asyncpg.Record) -> dict[str, Any]:
        metadata = _normalize_metadata(row['metadata'])
        return {
            'id': row['id'],
            'sessionId': row['sessionId'],
            'role': row['role'],
            'content': row['content'],
            'createdAt': row['createdAt'].isoformat() if row['createdAt'] else None,
            'sources': metadata.get('sources'),
            'confidence': metadata.get('confidence'),
            'modelUsed': metadata.get('modelUsed'),
            'evaluation': metadata.get('evaluation'),
            'evaluationJob': metadata.get('evaluationJob'),
        }

    def _map_evaluation_job_row(self, row: asyncpg.Record) -> dict[str, Any]:
        metadata = _normalize_metadata(row['metadata'])
        return {
            'id': row['id'],
            'userId': row['userId'],
            'sessionId': row['sessionId'],
            'messageId': row['messageId'],
            'status': row['status'],
            'score': row['score'],
            'language': row['language'],
            'rationale': row['rationale'],
            'passed': row['passed'],
            'total': row['total'],
            'executionTimeMs': row['executionTimeMs'],
            'stderr': row['stderr'],
            'stdout': row['stdout'],
            'testCode': row['testCode'],
            'modelUsed': row['modelUsed'],
            'errorMessage': row['errorMessage'],
            'scorePhase': metadata.get('scorePhase', 'final' if row['status'] in {'completed', 'failed'} else None),
            'isFinal': metadata.get('isFinal', row['status'] in {'completed', 'failed'}),
            'metadata': metadata,
            'createdAt': row['createdAt'].isoformat() if row['createdAt'] else None,
            'updatedAt': row['updatedAt'].isoformat() if row['updatedAt'] else None,
            'completedAt': row['completedAt'].isoformat() if row['completedAt'] else None,
        }


student_programming_chat_service = StudentProgrammingChatService()
