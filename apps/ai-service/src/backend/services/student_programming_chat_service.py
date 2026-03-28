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
            'CREATE INDEX IF NOT EXISTS "StudentProgrammingChatSession_userId_idx" ON "StudentProgrammingChatSession"("userId", "updatedAt" DESC)',
            'CREATE INDEX IF NOT EXISTS "StudentProgrammingChatMessage_sessionId_idx" ON "StudentProgrammingChatMessage"("sessionId", "createdAt")',
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
        }


student_programming_chat_service = StudentProgrammingChatService()
