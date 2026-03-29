from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import asyncpg

from src.evaluation.datasets.loaders.humaneval_loader import load_humaneval_samples
from src.evaluation.datasets.loaders.mbpp_loader import load_mbpp_samples
from src.evaluation.datasets.schemas import EvaluationSample


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


class BenchmarkIndexService:
    _instance = None
    _pool: asyncpg.Pool | None = None

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
                min_size=1,
                max_size=4,
                command_timeout=30,
            )
        return self._pool

    async def ensure_schema(self) -> None:
        pool = await self._get_pool()
        statements = [
            '''
            CREATE TABLE IF NOT EXISTS "BenchmarkItem" (
                id TEXT PRIMARY KEY,
                "datasetName" TEXT NOT NULL,
                language TEXT NOT NULL,
                title TEXT NOT NULL,
                prompt TEXT NOT NULL,
                "entryPoint" TEXT,
                "testCode" TEXT NOT NULL,
                "referenceSolution" TEXT,
                topic TEXT,
                difficulty TEXT,
                "sourcePath" TEXT,
                metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
            )
            ''',
            'CREATE INDEX IF NOT EXISTS "BenchmarkItem_dataset_language_idx" ON "BenchmarkItem"("datasetName", language)',
            'CREATE INDEX IF NOT EXISTS "BenchmarkItem_entryPoint_idx" ON "BenchmarkItem"("entryPoint")',
        ]
        async with pool.acquire() as conn:
            for statement in statements:
                await conn.execute(statement)

    async def upsert_item(self, sample: EvaluationSample, *, source_path: str | None = None) -> None:
        pool = await self._get_pool()
        query = '''
            INSERT INTO "BenchmarkItem" (
                id, "datasetName", language, title, prompt, "entryPoint", "testCode",
                "referenceSolution", topic, difficulty, "sourcePath", metadata, "createdAt", "updatedAt"
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7,
                $8, $9, $10, $11, $12::jsonb, $13, $14
            )
            ON CONFLICT (id) DO UPDATE SET
                "datasetName" = EXCLUDED."datasetName",
                language = EXCLUDED.language,
                title = EXCLUDED.title,
                prompt = EXCLUDED.prompt,
                "entryPoint" = EXCLUDED."entryPoint",
                "testCode" = EXCLUDED."testCode",
                "referenceSolution" = EXCLUDED."referenceSolution",
                topic = EXCLUDED.topic,
                difficulty = EXCLUDED.difficulty,
                "sourcePath" = EXCLUDED."sourcePath",
                metadata = EXCLUDED.metadata,
                "updatedAt" = EXCLUDED."updatedAt"
        '''
        now = _normalize_timestamp(_utc_now().isoformat())
        title = sample.metadata.get('source') if sample.metadata.get('source') else sample.sample_id
        async with pool.acquire() as conn:
            await conn.execute(
                query,
                sample.sample_id,
                sample.dataset_name,
                sample.language,
                title,
                sample.prompt,
                sample.entry_point,
                sample.test_code,
                sample.reference_solution,
                sample.metadata.get('topic'),
                sample.metadata.get('difficulty'),
                source_path,
                json.dumps(sample.metadata),
                now,
                now,
            )

    async def list_items(self, language: str) -> list[dict[str, Any]]:
        pool = await self._get_pool()
        query = 'SELECT * FROM "BenchmarkItem" WHERE language = $1 ORDER BY "datasetName", id'
        async with pool.acquire() as conn:
            rows = await conn.fetch(query, language)
        return [self._map_row(row) for row in rows]

    async def delete_items_by_dataset_name(self, dataset_name: str) -> int:
        pool = await self._get_pool()
        query = 'DELETE FROM "BenchmarkItem" WHERE "datasetName" = $1'
        async with pool.acquire() as conn:
            result = await conn.execute(query, dataset_name)
        return int(str(result).split()[-1]) if result else 0

    async def seed_from_fixtures(self) -> None:
        await self.ensure_schema()
        humaneval_path = Path('src/evaluation/datasets/samples/humaneval_smoke.jsonl')
        mbpp_path = Path('src/evaluation/datasets/samples/mbpp_smoke.json')
        if humaneval_path.exists():
            for sample in load_humaneval_samples(humaneval_path):
                await self.upsert_item(sample, source_path=str(humaneval_path))
        if mbpp_path.exists():
            for sample in load_mbpp_samples(mbpp_path):
                await self.upsert_item(sample, source_path=str(mbpp_path))

    def _map_row(self, row: asyncpg.Record) -> dict[str, Any]:
        return {
            'id': row['id'],
            'datasetName': row['datasetName'],
            'language': row['language'],
            'title': row['title'],
            'prompt': row['prompt'],
            'entryPoint': row['entryPoint'],
            'testCode': row['testCode'],
            'referenceSolution': row['referenceSolution'],
            'topic': row['topic'],
            'difficulty': row['difficulty'],
            'sourcePath': row['sourcePath'],
            'metadata': row['metadata'] or {},
            'createdAt': row['createdAt'].isoformat() if row['createdAt'] else None,
            'updatedAt': row['updatedAt'].isoformat() if row['updatedAt'] else None,
        }


benchmark_index_service = BenchmarkIndexService()
