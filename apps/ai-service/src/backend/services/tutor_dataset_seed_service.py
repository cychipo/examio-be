from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from src.backend.services.tutor_storage_service import tutor_storage_service
from src.genai_tutor.knowledge_base.ingestion_pipeline import tutor_ingestion_pipeline

logger = logging.getLogger(__name__)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_timestamp(value: Any) -> Any:
    if value is None:
        return None
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


class TutorDatasetSeedService:
    async def ensure_schema(self) -> None:
        pool = await tutor_storage_service._get_pool()  # noqa: SLF001
        statements = [
            """
            CREATE TABLE IF NOT EXISTS "TutorDatasetSeed" (
                "datasetKey" TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                "sourcePath" TEXT NOT NULL,
                "courseCode" TEXT NOT NULL,
                language TEXT,
                topic TEXT,
                difficulty TEXT,
                "seedVersion" TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                "lastJobId" TEXT,
                "lastError" TEXT,
                metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
                "completedAt" TIMESTAMP
            )
            """,
        ]

        async with pool.acquire() as conn:
            for statement in statements:
                await conn.execute(statement)

    async def bootstrap_if_enabled(self) -> dict[str, Any]:
        if os.getenv('ENABLE_TUTOR_DATASET_BOOTSTRAP', 'false').lower() != 'true':
            return {'enabled': False, 'scheduled': [], 'skipped': []}

        manifest_path = self._resolve_manifest_path()
        manifest = self._load_manifest(manifest_path)
        await self.sync_job_statuses()

        scheduled: list[str] = []
        skipped: list[str] = []

        for entry in manifest:
            dataset_key = entry['datasetKey']
            existing = await self.get_seed_record(dataset_key)

            if self._should_skip(existing, entry):
                skipped.append(dataset_key)
                continue

            source_path = entry['sourcePath']
            try:
                job = await tutor_ingestion_pipeline.create_job(
                    source_path=source_path,
                    triggered_by='dataset-bootstrap',
                    course_code=entry['courseCode'],
                    language=entry.get('language'),
                    topic=entry.get('topic'),
                    difficulty=entry.get('difficulty'),
                    reindex_mode=entry.get('reindexMode', 'incremental'),
                    license_tag=entry.get('licenseTag'),
                    dry_run=False,
                )
                await self.upsert_seed_record(
                    {
                        **entry,
                        'status': 'queued',
                        'lastJobId': job.job_id,
                        'lastError': None,
                        'metadata': entry.get('metadata', {}),
                    }
                )
                scheduled.append(dataset_key)
            except Exception as exc:
                logger.error('Failed to queue dataset seed %s: %s', dataset_key, exc)
                await self.upsert_seed_record(
                    {
                        **entry,
                        'status': 'failed',
                        'lastJobId': existing.get('lastJobId') if existing else None,
                        'lastError': str(exc),
                        'metadata': entry.get('metadata', {}),
                    }
                )
                skipped.append(dataset_key)

        return {
            'enabled': True,
            'manifestPath': str(manifest_path),
            'scheduled': scheduled,
            'skipped': skipped,
        }

    async def sync_job_statuses(self) -> None:
        pool = await tutor_storage_service._get_pool()  # noqa: SLF001
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                'SELECT * FROM "TutorDatasetSeed" WHERE "lastJobId" IS NOT NULL AND status IN ($1, $2)',
                'queued',
                'running',
            )

        for row in rows:
            job = await tutor_storage_service.fetch_job(row['lastJobId'])
            if job is None:
                continue

            status = job['status']
            normalized_status = 'completed' if status in {'success', 'partial_success'} else status
            completed_at = _utc_now().isoformat() if normalized_status in {'completed', 'failed'} else None
            await self.upsert_seed_record(
                {
                    'datasetKey': row['datasetKey'],
                    'title': row['title'],
                    'sourcePath': row['sourcePath'],
                    'courseCode': row['courseCode'],
                    'language': row['language'],
                    'topic': row['topic'],
                    'difficulty': row['difficulty'],
                    'seedVersion': row['seedVersion'],
                    'status': normalized_status,
                    'lastJobId': row['lastJobId'],
                    'lastError': '; '.join(job.get('errors') or []) or None,
                    'metadata': row['metadata'] or {},
                    'completedAt': completed_at,
                }
            )

    async def get_seed_record(self, dataset_key: str) -> dict[str, Any] | None:
        pool = await tutor_storage_service._get_pool()  # noqa: SLF001
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                'SELECT * FROM "TutorDatasetSeed" WHERE "datasetKey" = $1',
                dataset_key,
            )
        return dict(row) if row else None

    async def upsert_seed_record(self, payload: dict[str, Any]) -> None:
        pool = await tutor_storage_service._get_pool()  # noqa: SLF001
        query = """
            INSERT INTO "TutorDatasetSeed" (
                "datasetKey", title, "sourcePath", "courseCode", language,
                topic, difficulty, "seedVersion", status, "lastJobId",
                "lastError", metadata, "createdAt", "updatedAt", "completedAt"
            ) VALUES (
                $1, $2, $3, $4, $5,
                $6, $7, $8, $9, $10,
                $11, $12::jsonb, $13, $14, $15
            )
            ON CONFLICT ("datasetKey") DO UPDATE SET
                title = EXCLUDED.title,
                "sourcePath" = EXCLUDED."sourcePath",
                "courseCode" = EXCLUDED."courseCode",
                language = EXCLUDED.language,
                topic = EXCLUDED.topic,
                difficulty = EXCLUDED.difficulty,
                "seedVersion" = EXCLUDED."seedVersion",
                status = EXCLUDED.status,
                "lastJobId" = EXCLUDED."lastJobId",
                "lastError" = EXCLUDED."lastError",
                metadata = EXCLUDED.metadata,
                "updatedAt" = EXCLUDED."updatedAt",
                "completedAt" = EXCLUDED."completedAt"
        """
        now = _utc_now().isoformat()
        async with pool.acquire() as conn:
            await conn.execute(
                query,
                payload['datasetKey'],
                payload['title'],
                payload['sourcePath'],
                payload['courseCode'],
                payload.get('language'),
                payload.get('topic'),
                payload.get('difficulty'),
                payload['seedVersion'],
                payload['status'],
                payload.get('lastJobId'),
                payload.get('lastError'),
                json.dumps(payload.get('metadata', {})),
                _normalize_timestamp(payload.get('createdAt') or now),
                _normalize_timestamp(now),
                _normalize_timestamp(payload.get('completedAt')),
            )

    def _resolve_manifest_path(self) -> Path:
        configured_path = os.getenv('TUTOR_DATASET_SEED_MANIFEST')
        if configured_path:
            return Path(configured_path).expanduser().resolve()

        return (Path(__file__).resolve().parents[1] / 'config' / 'tutor_dataset_seed_manifest.json').resolve()

    def _load_manifest(self, manifest_path: Path) -> list[dict[str, Any]]:
        if not manifest_path.exists():
            raise FileNotFoundError(f'Dataset seed manifest not found: {manifest_path}')

        with manifest_path.open('r', encoding='utf-8') as file:
            payload = json.load(file)

        if not isinstance(payload, list):
            raise ValueError('Dataset seed manifest must be a JSON array')

        required_fields = {'datasetKey', 'title', 'sourcePath', 'courseCode', 'seedVersion'}
        for item in payload:
            missing = required_fields.difference(item.keys())
            if missing:
                raise ValueError(f'Dataset seed manifest entry is missing fields: {sorted(missing)}')
        return payload

    def _should_skip(self, existing: dict[str, Any] | None, entry: dict[str, Any]) -> bool:
        if existing is None:
            return False

        if existing.get('seedVersion') != entry['seedVersion']:
            return False

        return existing.get('status') in {'queued', 'running', 'completed'}


tutor_dataset_seed_service = TutorDatasetSeedService()
