from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse
from typing import Any, Optional
from uuid import uuid4

import asyncpg
import aio_pika
import httpx
import grpc

from src.backend.grpc_generated import r2_pb2, r2_pb2_grpc
from src.backend.services.benchmark_index_service import benchmark_index_service
from src.evaluation.datasets.schemas import EvaluationSample

from src.backend.services.tutor_storage_service import tutor_storage_service
from src.genai_tutor.knowledge_base.ingestion_pipeline import tutor_ingestion_pipeline

logger = logging.getLogger(__name__)
DATASET_IMPORT_ROUTING_KEY = 'ai.tutor.dataset-import.requested'


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


class DatasetImportCancelledError(Exception):
    pass


DATASET_CATALOG: list[dict[str, Any]] = [
    {
        'datasetKey': 'humaneval-python',
        'title': 'HumanEval Python',
        'description': '164 bài toán lập trình Python cơ bản từ OpenAI HumanEval.',
        'source': 'huggingface',
        'repository': 'openai/openai_humaneval',
        'courseCode': 'PYTHON_DATASETS',
        'language': 'python',
        'topic': 'programming-problems',
        'difficulty': 'basic',
    },
    {
        'datasetKey': 'mbpp-python',
        'title': 'MBPP Python',
        'description': 'Mostly Basic Python Problems cho người mới bắt đầu.',
        'source': 'huggingface',
        'repository': 'google-research-datasets/mbpp',
        'config': 'sanitized',
        'courseCode': 'PYTHON_DATASETS',
        'language': 'python',
        'topic': 'basic-python',
        'difficulty': 'basic',
    },
    {
        'datasetKey': 'multipl-e-humaneval-cpp',
        'title': 'MultiPL-E HumanEval C++',
        'description': '164 bài toán HumanEval bản C++ từ MultiPL-E để nạp GraphRAG và benchmark.',
        'source': 'huggingface',
        'repository': 'nuprl/MultiPL-E',
        'config': 'humaneval-cpp',
        'courseCode': 'CPP_DATASETS',
        'language': 'cpp',
        'topic': 'programming-problems',
        'difficulty': 'intermediate',
    },
    {
        'datasetKey': 'multipl-e-mbpp-cpp',
        'title': 'MultiPL-E MBPP C++',
        'description': 'Các bài toán MBPP bản C++ từ MultiPL-E để nạp GraphRAG và benchmark.',
        'source': 'huggingface',
        'repository': 'nuprl/MultiPL-E',
        'config': 'mbpp-cpp',
        'courseCode': 'CPP_DATASETS',
        'language': 'cpp',
        'topic': 'basic-cpp',
        'difficulty': 'basic',
    },
]


class TutorDatasetImportService:
    _instance = None
    _pool: Optional[asyncpg.Pool] = None
    _tasks: dict[str, asyncio.Task[Any]]

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._tasks = {}
        return cls._instance

    def __init__(self) -> None:
        if not hasattr(self, '_tasks'):
            self._tasks: dict[str, asyncio.Task[Any]] = {}

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
        return self._pool

    async def ensure_schema(self) -> None:
        pool = await self._get_pool()
        statements = [
            """
            CREATE TABLE IF NOT EXISTS "TutorDatasetImportJob" (
                id TEXT PRIMARY KEY,
                "userId" TEXT NOT NULL,
                "folderId" TEXT,
                "datasetKey" TEXT NOT NULL,
                title TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'queued',
                progress INTEGER NOT NULL DEFAULT 0,
                stage TEXT NOT NULL DEFAULT 'queued',
                message TEXT,
                "sourcePath" TEXT,
                "ingestJobId" TEXT,
                "downloadedFiles" INTEGER NOT NULL DEFAULT 0,
                "processedFiles" INTEGER NOT NULL DEFAULT 0,
                "totalFiles" INTEGER NOT NULL DEFAULT 0,
                metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                "errorMessage" TEXT,
                "importedFolderId" TEXT,
                "artifactUrl" TEXT,
                "artifactKeyR2" TEXT,
                "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
                "completedAt" TIMESTAMP
            )
            """,
            'ALTER TABLE "TutorDatasetImportJob" ADD COLUMN IF NOT EXISTS "importedFolderId" TEXT',
            'ALTER TABLE "TutorDatasetImportJob" ADD COLUMN IF NOT EXISTS "artifactUrl" TEXT',
            'ALTER TABLE "TutorDatasetImportJob" ADD COLUMN IF NOT EXISTS "artifactKeyR2" TEXT',
            'CREATE INDEX IF NOT EXISTS "TutorDatasetImportJob_userId_idx" ON "TutorDatasetImportJob"("userId")',
        ]
        async with pool.acquire() as conn:
            for statement in statements:
                await conn.execute(statement)

    def list_catalog(self) -> list[dict[str, Any]]:
        return DATASET_CATALOG

    async def list_jobs(self, user_id: str) -> list[dict[str, Any]]:
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                'SELECT * FROM "TutorDatasetImportJob" WHERE "userId" = $1 ORDER BY "createdAt" DESC',
                user_id,
            )
        return [self._map_row(row) for row in rows]

    async def list_dataset_states(self, user_id: str) -> list[dict[str, Any]]:
        jobs = await self.list_jobs(user_id)
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            folder_rows = await conn.fetch(
                'SELECT id FROM "TutorKnowledgeFolder" WHERE "userId" = $1',
                user_id,
            )
        existing_folder_ids = {row['id'] for row in folder_rows}
        states: list[dict[str, Any]] = []

        for dataset in DATASET_CATALOG:
            dataset_jobs = [job for job in jobs if job['datasetKey'] == dataset['datasetKey']]
            latest_job = dataset_jobs[0] if dataset_jobs else None
            completed_job = next(
                (
                    job
                    for job in dataset_jobs
                    if job['status'] == 'completed'
                    and (job.get('importedFolderId') or job.get('folderId')) in existing_folder_ids
                ),
                None,
            )

            states.append(
                {
                    'datasetKey': dataset['datasetKey'],
                    'imported': completed_job is not None,
                    'importedFolderId': completed_job.get('importedFolderId') if completed_job else None,
                    'importedAt': completed_job.get('completedAt') if completed_job else None,
                    'latestJob': latest_job,
                    'lastSuccessfulJob': completed_job,
                }
            )

        return states

    async def get_job(self, job_id: str) -> Optional[dict[str, Any]]:
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow('SELECT * FROM "TutorDatasetImportJob" WHERE id = $1', job_id)
        return self._map_row(row) if row else None

    async def create_job(self, *, user_id: str, folder_id: Optional[str], dataset_key: str) -> dict[str, Any]:
        if not folder_id:
            raise ValueError('Folder là bắt buộc khi nạp dataset')

        dataset = self._get_dataset(dataset_key)
        existing = await self.get_existing_dataset_import(user_id=user_id, dataset_key=dataset_key)
        if existing:
            imported_folder_id = existing.get('importedFolderId') or existing.get('folderId')
            if existing.get('status') in {'queued', 'downloading', 'processing', 'cancelling'}:
                raise ValueError('Dataset này đang được nạp rồi, vui lòng chờ hoàn tất hoặc hủy job hiện tại')
            if existing.get('status') == 'completed':
                raise ValueError(
                    f'Dataset này đã được nạp ở folder {imported_folder_id}. Không thể nạp sang folder khác.'
                )

        job_id = f'dataset_import_{uuid4().hex[:12]}'
        payload = {
            'jobId': job_id,
            'userId': user_id,
            'folderId': folder_id,
            'datasetKey': dataset_key,
            'title': dataset['title'],
            'status': 'queued',
            'progress': 0,
            'stage': 'queued',
            'message': 'Đã tạo job nạp dataset',
            'sourcePath': None,
            'ingestJobId': None,
            'downloadedFiles': 0,
            'processedFiles': 0,
            'totalFiles': 0,
            'artifactUrl': None,
            'artifactKeyR2': None,
            'metadata': {'dataset': dataset},
            'errorMessage': None,
            'importedFolderId': folder_id,
            'createdAt': _utc_now().isoformat(),
            'updatedAt': _utc_now().isoformat(),
            'completedAt': None,
        }
        await self._upsert_job(payload)

        rabbitmq_url = os.getenv('RABBITMQ_URL')
        if rabbitmq_url:
            connection = await aio_pika.connect_robust(rabbitmq_url)
            async with connection:
                channel = await connection.channel()
                exchange = await channel.declare_exchange(
                    'examio.events',
                    aio_pika.ExchangeType.TOPIC,
                    durable=True,
                )
                event = {
                    'type': 'tutor.dataset-import.requested',
                    'timestamp': int(_utc_now().timestamp() * 1000),
                    'payload': {
                        'jobId': job_id,
                        'datasetKey': dataset_key,
                    },
                    'metadata': {'sourceService': 'ai-service'},
                }
                await exchange.publish(
                    aio_pika.Message(body=json.dumps(event).encode()),
                    routing_key=DATASET_IMPORT_ROUTING_KEY,
                )
        else:
            self._tasks[job_id] = asyncio.create_task(self._run_job(job_id))
        return await self.get_job(job_id) or payload

    async def cancel_job(self, job_id: str) -> dict[str, Any]:
        job = await self.get_job(job_id)
        if job is None:
            raise ValueError('Job nạp dataset không tồn tại')
        if job['status'] in {'completed', 'cancelled', 'failed'}:
            raise ValueError('Job này không thể hủy nữa')

        await self._update_job(
            job_id,
            status='cancelling',
            stage='cancelling',
            message='Đang hủy job và dọn dữ liệu đã nạp...',
        )
        return await self.get_job(job_id) or job

    async def clear_dataset(self, *, user_id: str, dataset_key: str) -> dict[str, Any]:
        existing = await self.get_existing_dataset_import(
            user_id=user_id,
            dataset_key=dataset_key,
        )
        if existing is None:
            raise ValueError('Dataset này chưa có dữ liệu để xóa')
        if existing.get('status') in {'queued', 'downloading', 'processing', 'cancelling'}:
            raise ValueError('Dataset đang được xử lý. Hãy hủy job hiện tại trước khi clear')

        trigger = f'dataset-import:{dataset_key}:%'
        await tutor_storage_service.delete_jobs_by_trigger(trigger)

        deleted_benchmark_items = 0
        benchmark_dataset_name = self._benchmark_dataset_name_for_dataset_key(dataset_key)
        if benchmark_dataset_name:
            deleted_benchmark_items = await benchmark_index_service.delete_items_by_dataset_name(
                benchmark_dataset_name
            )

        pool = await self._get_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                'DELETE FROM "TutorDatasetImportJob" WHERE "userId" = $1 AND "datasetKey" = $2',
                user_id,
                dataset_key,
            )

        return {
            'success': True,
            'datasetKey': dataset_key,
            'deletedBenchmarkItems': deleted_benchmark_items,
            'message': 'Đã xóa toàn bộ dữ liệu dataset, benchmark liên quan và lịch sử import trong DB. Artifact trên R2 được giữ lại để tái sử dụng.',
        }

    def _benchmark_dataset_name_for_dataset_key(self, dataset_key: str) -> str | None:
        mapping = {
            'humaneval-python': 'humaneval',
            'mbpp-python': 'mbpp',
            'multipl-e-humaneval-cpp': 'multipl_e_humaneval_cpp',
            'multipl-e-mbpp-cpp': 'multipl_e_mbpp_cpp',
        }
        return mapping.get(dataset_key)

    async def run_job(self, job_id: str) -> None:
        await self._run_job(job_id)

    async def get_existing_dataset_import(self, *, user_id: str, dataset_key: str) -> Optional[dict[str, Any]]:
        pool = await self._get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                'SELECT * FROM "TutorDatasetImportJob" WHERE "userId" = $1 AND "datasetKey" = $2 ORDER BY "createdAt" DESC LIMIT $3',
                user_id,
                dataset_key,
                1,
            )
        return self._map_row(row) if row else None

    async def _find_reusable_artifact_job(
        self,
        user_id: str,
        dataset_key: str,
        *,
        exclude_job_id: str,
    ) -> Optional[dict[str, Any]]:
        jobs = await self.list_jobs(user_id)
        for job in jobs:
            if job['jobId'] == exclude_job_id:
                continue
            if job['datasetKey'] != dataset_key:
                continue
            if job.get('artifactUrl') and job.get('artifactKeyR2'):
                return job
        return None

    async def _run_job(self, job_id: str) -> None:
        job = await self.get_job(job_id)
        if job is None:
            return
        metadata = _normalize_metadata(job.get('metadata'))
        dataset = metadata.get('dataset') or self._get_dataset(job['datasetKey'])
        try:
            await self._update_job(job_id, status='downloading', progress=5, stage='downloading', message='Đang tải dataset về máy chủ')
            reuse_job = await self._find_reusable_artifact_job(
                job['userId'],
                job['datasetKey'],
                exclude_job_id=job_id,
            )
            if (
                reuse_job and
                reuse_job.get('artifactUrl') and
                reuse_job.get('artifactKeyR2') and
                await self._artifact_exists_on_r2(reuse_job['artifactKeyR2'])
            ):
                await self._update_job(
                    job_id,
                    message='Tái sử dụng artifact dataset có sẵn trên R2',
                    artifactUrl=reuse_job['artifactUrl'],
                    artifactKeyR2=reuse_job['artifactKeyR2'],
                )
                source_path = await self._download_artifact_from_r2(
                    dataset_key=job['datasetKey'],
                    artifact_url=reuse_job['artifactUrl'],
                )
                artifact_url = reuse_job['artifactUrl']
                artifact_key = reuse_job['artifactKeyR2']
            else:
                if reuse_job and reuse_job.get('artifactKeyR2'):
                    await self._update_job(
                        job_id,
                        message='Artifact R2 cũ không còn tồn tại, hệ thống sẽ tải lại từ nguồn gốc',
                    )
                source_path, artifact_url, artifact_key = await self._download_dataset(dataset, job_id)
            if await self._is_cancel_requested(job_id):
                await self._cleanup_job(job_id, source_path=source_path)
                return

            total_files = self._count_supported_files(source_path)
            if total_files == 0:
                raise RuntimeError(
                    'Dataset không chứa file nguồn hỗ trợ để ingest. Hãy kiểm tra lại định dạng materialized dataset.'
                )
            await self._index_benchmark_dataset_if_supported(
                dataset=dataset,
                source_path=source_path,
                job_id=job_id,
            )
            await self._update_job(
                job_id,
                status='processing',
                progress=35,
                stage='ingesting',
                sourcePath=str(source_path),
                downloadedFiles=total_files,
                totalFiles=total_files,
                message='Đang đưa dataset vào pipeline GraphRAG',
                artifactUrl=artifact_url,
                artifactKeyR2=artifact_key,
            )

            ingest_job = await tutor_ingestion_pipeline.create_job(
                source_path=str(source_path),
                triggered_by=f'dataset-import:{dataset["datasetKey"]}:{job_id}',
                course_code=dataset['courseCode'],
                language=dataset.get('language'),
                topic=dataset.get('topic'),
                difficulty=dataset.get('difficulty'),
                reindex_mode='full',
                license_tag=None,
                dry_run=False,
            )
            await self._update_job(job_id, ingestJobId=ingest_job.job_id)

            while True:
                await asyncio.sleep(1)
                if await self._is_cancel_requested(job_id):
                    await self._cleanup_job(job_id, source_path=source_path, ingest_job_id=ingest_job.job_id)
                    return
                ingest_snapshot = await tutor_storage_service.fetch_job(ingest_job.job_id)
                if ingest_snapshot is None:
                    continue
                summary = ingest_snapshot.get('summary') or {}
                if isinstance(summary, str):
                    try:
                        summary = json.loads(summary)
                    except json.JSONDecodeError:
                        summary = {}
                processed_files = summary.get('processed_files', 0) or summary.get('processedFiles', 0) or 0
                total = summary.get('total_files', 0) or summary.get('totalFiles', 0) or total_files
                progress = 35 if not total else min(99, 35 + int((processed_files / max(total, 1)) * 64))
                await self._update_job(
                    job_id,
                    status='processing',
                    progress=progress,
                    stage='graphing',
                    processedFiles=processed_files,
                    totalFiles=total,
                    message=f'Đã xử lý {processed_files}/{total} file',
                )
                if ingest_snapshot.get('status') in {'success', 'partial_success', 'failed'}:
                    if ingest_snapshot.get('status') == 'failed':
                        errors = ingest_snapshot.get('errors') or []
                        if isinstance(errors, str):
                            error_message = errors
                        else:
                            error_message = '; '.join(errors)
                        raise RuntimeError(error_message or 'Dataset import failed')
                    break

            await self._update_job(
                job_id,
                status='completed',
                progress=100,
                stage='completed',
                message='Đã nạp xong toàn bộ dataset vào hệ thống',
                importedFolderId=job.get('folderId'),
                metadata={
                    **(job.get('metadata') or {}),
                    'result': await self._build_result_metrics(ingest_job.job_id),
                },
                completedAt=_utc_now().isoformat(),
            )
            if source_path.exists():
                shutil.rmtree(source_path, ignore_errors=True)
        except DatasetImportCancelledError:
            await self._cleanup_job(job_id)
        except Exception as exc:
            logger.exception('Dataset import job failed: %s', job_id)
            await self._update_job(
                job_id,
                status='failed',
                progress=100,
                stage='failed',
                message='Nạp dataset thất bại',
                errorMessage=str(exc),
                completedAt=_utc_now().isoformat(),
            )

    async def _download_dataset(self, dataset: dict[str, Any], job_id: str) -> tuple[Path, str, str]:
        target_root = self._job_work_root(dataset['datasetKey'], job_id) / 'source'
        if target_root.parent.exists():
            shutil.rmtree(target_root.parent)
        target_root.parent.mkdir(parents=True, exist_ok=True)

        if dataset['source'] == 'git':
            process = await asyncio.create_subprocess_exec(
                'git',
                'clone',
                dataset['repository'],
                str(target_root),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            while process.returncode is None:
                if await self._is_cancel_requested(job_id):
                    process.terminate()
                    try:
                        await asyncio.wait_for(process.wait(), timeout=3)
                    except asyncio.TimeoutError:
                        process.kill()
                        await process.wait()
                    raise DatasetImportCancelledError()
                await asyncio.sleep(0.5)

            stdout, stderr = await process.communicate()
            if process.returncode != 0:
                raise RuntimeError(stderr.decode() or stdout.decode() or 'Git clone failed')
            return await self._archive_and_upload_dataset(dataset, target_root, job_id)

        if dataset['source'] == 'huggingface':
            materialized_root = await self._materialize_huggingface_dataset(dataset, target_root, job_id)
            return await self._archive_and_upload_dataset(dataset, materialized_root, job_id)

        raise ValueError(f'Unsupported dataset source: {dataset["source"]}')

    async def _index_benchmark_dataset_if_supported(
        self,
        *,
        dataset: dict[str, Any],
        source_path: Path,
        job_id: str,
    ) -> None:
        dataset_key = dataset.get('datasetKey')
        if dataset_key not in {'humaneval-python', 'mbpp-python', 'multipl-e-humaneval-cpp', 'multipl-e-mbpp-cpp'}:
            return

        try:
            await benchmark_index_service.ensure_schema()

            samples: list[EvaluationSample] = []
            source_files: list[str] = []

            if dataset_key == 'humaneval-python':
                jsonl_files = sorted(source_path.glob('**/*.jsonl'))
                if jsonl_files:
                    from src.evaluation.datasets.loaders.humaneval_loader import load_humaneval_samples

                    for file_path in jsonl_files:
                        loaded_samples = load_humaneval_samples(file_path)
                        if loaded_samples:
                            samples.extend(loaded_samples)
                            source_files.append(str(file_path))
                else:
                    samples = self._load_materialized_humaneval_samples(source_path)
                    if samples:
                        source_files.append(str(source_path))
            elif dataset_key == 'mbpp-python':
                json_files = sorted(source_path.glob('**/*.json'))
                if json_files:
                    from src.evaluation.datasets.loaders.mbpp_loader import load_mbpp_samples

                    for file_path in json_files:
                        try:
                            loaded_samples = load_mbpp_samples(file_path)
                        except Exception as exc:
                            logger.warning(
                                'Skipping MBPP benchmark file %s due to parse error: %s',
                                file_path,
                                exc,
                            )
                            continue
                        if loaded_samples:
                            samples.extend(loaded_samples)
                            source_files.append(str(file_path))
                else:
                    samples = self._load_materialized_mbpp_samples(source_path)
                    if samples:
                        source_files.append(str(source_path))
            elif dataset_key == 'multipl-e-humaneval-cpp':
                samples = self._load_materialized_humaneval_cpp_samples(source_path)
                if samples:
                    source_files.append(str(source_path))
            else:
                samples = self._load_materialized_mbpp_cpp_samples(source_path)
                if samples:
                    source_files.append(str(source_path))

            deduplicated_samples: dict[str, EvaluationSample] = {}
            for sample in samples:
                deduplicated_samples[sample.sample_id] = sample

            unique_samples = list(deduplicated_samples.values())

            if not unique_samples:
                logger.warning(
                    'No benchmark samples found to seed for dataset %s at %s',
                    dataset_key,
                    source_path,
                )
                return

            source_path_for_upsert = source_files[0] if source_files else str(source_path)
            for sample in unique_samples:
                await benchmark_index_service.upsert_item(sample, source_path=source_path_for_upsert)

            await self._update_job(
                job_id,
                metadata={
                    'benchmarkIndexing': {
                        'seeded': len(unique_samples),
                        'parsed': len(samples),
                        'datasetKey': dataset_key,
                        'sourcePath': source_path_for_upsert,
                        'sourcePaths': source_files,
                    },
                },
            )
            logger.info(
                'Seeded %s benchmark items (parsed=%s) for dataset %s from %s source file(s)',
                len(unique_samples),
                len(samples),
                dataset_key,
                len(source_files),
            )
        except Exception as exc:
            logger.warning('Failed to seed benchmark index for %s: %s', dataset_key, exc)

    def _split_materialized_sections(self, content: str) -> tuple[str, dict[str, str]]:
        lines = content.splitlines()
        prompt_lines: list[str] = []
        sections: dict[str, list[str]] = {}
        current_section: str | None = None

        for line in lines:
            stripped = line.strip()
            if stripped.startswith('# '):
                current_section = stripped[2:].strip().lower()
                sections.setdefault(current_section, [])
                continue

            if current_section is None:
                prompt_lines.append(line)
            else:
                sections[current_section].append(line)

        return '\n'.join(prompt_lines).strip(), {
            key: '\n'.join(value).strip() for key, value in sections.items()
        }

    def _load_materialized_humaneval_samples(self, source_path: Path) -> list[EvaluationSample]:
        samples: list[EvaluationSample] = []
        for path in sorted(source_path.glob('**/humaneval-python_*.py')):
            content = path.read_text(encoding='utf-8')
            prompt, sections = self._split_materialized_sections(content)
            first_line = prompt.splitlines()[0].strip() if prompt else path.stem
            sample_id = first_line.replace('Task: ', '').strip() if first_line.startswith('Task: ') else path.stem
            remaining_prompt = '\n'.join(prompt.splitlines()[1:]).strip() if first_line.startswith('Task: ') else prompt
            samples.append(
                EvaluationSample(
                    sample_id=sample_id,
                    dataset_name='humaneval',
                    language='python',
                    prompt=remaining_prompt,
                    reference_solution=sections.get('canonical solution'),
                    test_code=sections.get('test', ''),
                    entry_point=None,
                    metadata={
                        'source': 'HumanEval',
                        'task_id': sample_id,
                    },
                )
            )
        return samples

    def _load_materialized_mbpp_samples(self, source_path: Path) -> list[EvaluationSample]:
        samples: list[EvaluationSample] = []
        for path in sorted(source_path.glob('**/mbpp-python_*.py')):
            content = path.read_text(encoding='utf-8')
            prompt, sections = self._split_materialized_sections(content)
            first_line = prompt.splitlines()[0].strip() if prompt else path.stem
            sample_id = first_line.replace('Task ID: ', '').strip() if first_line.startswith('Task ID: ') else path.stem
            remaining_prompt = '\n'.join(prompt.splitlines()[1:]).strip() if first_line.startswith('Task ID: ') else prompt
            tests = sections.get('tests', '')
            challenge_tests = sections.get('challenge tests', '')
            test_code = '\n'.join(part for part in [tests, challenge_tests] if part).strip()
            entry_point = self._extract_python_entry_point(sections.get('code'))
            samples.append(
                EvaluationSample(
                    sample_id=f'mbpp_{sample_id}',
                    dataset_name='mbpp',
                    language='python',
                    prompt=remaining_prompt,
                    reference_solution=sections.get('code'),
                    test_code=test_code,
                    entry_point=entry_point,
                    metadata={
                        'source': 'MBPP',
                        'task_id': sample_id,
                        'entry_point': entry_point,
                    },
                )
            )
        return samples

    def _load_materialized_humaneval_cpp_samples(self, source_path: Path) -> list[EvaluationSample]:
        samples: list[EvaluationSample] = []
        for path in sorted(source_path.glob('**/multipl-e-humaneval-cpp_*.cpp')):
            content = path.read_text(encoding='utf-8')
            prompt, sections = self._split_materialized_sections(content)
            first_line = prompt.splitlines()[0].strip() if prompt else path.stem
            sample_id = first_line.replace('Task: ', '').strip() if first_line.startswith('Task: ') else path.stem
            remaining_prompt = '\n'.join(prompt.splitlines()[1:]).strip() if first_line.startswith('Task: ') else prompt
            prompt_text = sections.get('prompt', '') or remaining_prompt
            reference_solution = sections.get('canonical solution') or sections.get('original')
            test_code = sections.get('tests', '')
            entry_point = sections.get('entry point') or self._extract_cpp_entry_point(prompt_text) or self._extract_cpp_entry_point(reference_solution)
            samples.append(
                EvaluationSample(
                    sample_id=sample_id,
                    dataset_name='multipl_e_humaneval_cpp',
                    language='cpp',
                    prompt=prompt_text,
                    reference_solution=reference_solution,
                    test_code=test_code,
                    entry_point=entry_point,
                    metadata={
                        'source': 'MultiPL-E',
                        'task_id': sample_id,
                        'entry_point': entry_point,
                    },
                )
            )
        return samples

    def _load_materialized_mbpp_cpp_samples(self, source_path: Path) -> list[EvaluationSample]:
        samples: list[EvaluationSample] = []
        for path in sorted(source_path.glob('**/multipl-e-mbpp-cpp_*.cpp')):
            content = path.read_text(encoding='utf-8')
            prompt, sections = self._split_materialized_sections(content)
            first_line = prompt.splitlines()[0].strip() if prompt else path.stem
            sample_id = first_line.replace('Task: ', '').strip() if first_line.startswith('Task: ') else path.stem
            remaining_prompt = '\n'.join(prompt.splitlines()[1:]).strip() if first_line.startswith('Task: ') else prompt
            prompt_text = sections.get('prompt', '') or remaining_prompt
            reference_solution = sections.get('canonical solution') or sections.get('original')
            tests = sections.get('tests', '')
            doctests = sections.get('doctests', '')
            test_code = '\n'.join(part for part in [tests, doctests] if part).strip()
            entry_point = sections.get('entry point') or self._extract_cpp_entry_point(prompt_text) or self._extract_cpp_entry_point(reference_solution)
            samples.append(
                EvaluationSample(
                    sample_id=f'mbpp_cpp_{sample_id}',
                    dataset_name='multipl_e_mbpp_cpp',
                    language='cpp',
                    prompt=prompt_text,
                    reference_solution=reference_solution,
                    test_code=test_code,
                    entry_point=entry_point,
                    metadata={
                        'source': 'MultiPL-E',
                        'task_id': sample_id,
                        'entry_point': entry_point,
                    },
                )
            )
        return samples

    def _extract_python_entry_point(self, code: str | None) -> str | None:
        if not code:
            return None

        for line in code.splitlines():
            stripped = line.strip()
            if stripped.startswith('def '):
                return stripped[4:].split('(', 1)[0].strip() or None

        return None

    def _extract_cpp_entry_point(self, code: str | None) -> str | None:
        if not code:
            return None

        patterns = [
            r'\b([A-Za-z_][A-Za-z0-9_]*)\s*\([^()]*\)\s*(?:const\s*)?\{',
            r'\b([A-Za-z_][A-Za-z0-9_]*)\s*\([^()]*\)\s*;',
        ]
        excluded = {'if', 'for', 'while', 'switch', 'return', 'catch'}

        for pattern in patterns:
            for match in re.finditer(pattern, code):
                name = match.group(1)
                if name not in excluded:
                    return name

        return None

    def _job_work_root(self, dataset_key: str, job_id: str) -> Path:
        return self._dataset_root() / dataset_key / job_id

    async def _materialize_huggingface_dataset(self, dataset: dict[str, Any], target_root: Path, job_id: str) -> Path:
        try:
            from datasets import load_dataset
        except Exception:
            return await self._materialize_huggingface_dataset_via_subprocess(
                dataset,
                target_root,
                job_id,
            )

        target_root.mkdir(parents=True, exist_ok=True)
        repository = dataset['repository']
        config = dataset.get('config')
        builder = load_dataset(repository, config) if config else load_dataset(repository)

        file_count = 0
        for split_name, split in builder.items():
            if await self._is_cancel_requested(job_id):
                raise DatasetImportCancelledError()
            split_token = str(split_name)
            split_dir = target_root / split_token
            split_dir.mkdir(parents=True, exist_ok=True)
            for index, row in enumerate(split):
                if await self._is_cancel_requested(job_id):
                    raise DatasetImportCancelledError()
                row_payload = dict(row)
                path = split_dir / self._build_hf_file_name(dataset['datasetKey'], split_token, index)
                path.write_text(self._format_hf_row(dataset['datasetKey'], row_payload, index), encoding='utf-8')
                file_count += 1
                if file_count % 50 == 0:
                    await self._update_job(
                        job_id,
                        status='downloading',
                        progress=min(30, 5 + file_count // 50),
                        stage='downloading',
                        downloadedFiles=file_count,
                        message=f'Đã tải và materialize {file_count} mẫu dataset',
                    )

        return target_root

    async def _materialize_huggingface_dataset_via_subprocess(
        self,
        dataset: dict[str, Any],
        target_root: Path,
        job_id: str,
    ) -> Path:
        target_root.mkdir(parents=True, exist_ok=True)

        helper_code = r'''
import json
import sys
from pathlib import Path

from datasets import load_dataset

dataset = json.loads(sys.argv[1])
target_root = Path(sys.argv[2])

def format_row(dataset_key, row, index):
    if dataset_key == 'humaneval-python':
        return '\n\n'.join(
            part for part in [
                f"Task: {row.get('task_id', f'humaneval_{index}')}",
                row.get('prompt', ''),
                '# Canonical solution',
                row.get('canonical_solution', ''),
                '# Test',
                row.get('test', ''),
            ] if part
        )
    if dataset_key == 'mbpp-python':
        return '\n\n'.join(
            part for part in [
                f"Task ID: {row.get('task_id', index)}",
                row.get('text', ''),
                '# Code',
                row.get('code', ''),
                '# Tests',
                '\n'.join(row.get('test_list', []) or []),
                '# Challenge tests',
                '\n'.join(row.get('challenge_test_list', []) or []),
            ] if part
        )
    if dataset_key == 'multipl-e-humaneval-cpp':
        return '\n\n'.join(
            part for part in [
                f"Task: {row.get('name', row.get('task_id', f'humaneval_cpp_{index}'))}",
                '# Prompt',
                row.get('prompt', ''),
                '# Tests',
                row.get('tests', ''),
                '# Original',
                row.get('original', ''),
                '# Entry point',
                row.get('entry_point', ''),
            ] if part
        )
    if dataset_key == 'multipl-e-mbpp-cpp':
        return '\n\n'.join(
            part for part in [
                f"Task: {row.get('name', row.get('task_id', f'mbpp_cpp_{index}'))}",
                '# Prompt',
                row.get('prompt', ''),
                '# Tests',
                row.get('tests', ''),
                '# Doctests',
                row.get('doctests', ''),
                '# Original',
                row.get('original', ''),
                '# Entry point',
                row.get('entry_point', ''),
            ] if part
        )
    if dataset_key == 'codesearchnet-python':
        return '\n\n'.join(
            part for part in [
                row.get('docstring') or row.get('func_documentation_string') or '',
                row.get('whole_func_string') or row.get('func_code_string') or '',
            ] if part
        )
    return json.dumps(row, ensure_ascii=False, indent=2)

def build_file_name(dataset_key, split_name, index):
    extension = 'json'
    if dataset_key in {'humaneval-python', 'mbpp-python', 'codesearchnet-python'}:
        extension = 'py'
    if dataset_key in {'multipl-e-humaneval-cpp', 'multipl-e-mbpp-cpp'}:
        extension = 'cpp'
    return f'{dataset_key}_{split_name}_{index:06d}.{extension}'

repository = dataset['repository']
config = dataset.get('config')
builder = load_dataset(repository, config) if config else load_dataset(repository)
file_count = 0

for split_name, split in builder.items():
    split_token = str(split_name)
    split_dir = target_root / split_token
    split_dir.mkdir(parents=True, exist_ok=True)
    for index, row in enumerate(split):
        payload = dict(row)
        path = split_dir / build_file_name(dataset['datasetKey'], split_token, index)
        path.write_text(format_row(dataset['datasetKey'], payload, index), encoding='utf-8')
        file_count += 1
        if file_count % 50 == 0:
            print(json.dumps({'type': 'progress', 'count': file_count}), flush=True)

print(json.dumps({'type': 'done', 'count': file_count}), flush=True)
'''

        candidates = [os.getenv('DATASET_IMPORT_PYTHON'), 'python3', sys.executable]
        last_error = 'No available Python interpreter for dataset import'

        for candidate in candidates:
            if not candidate:
                continue
            process = await asyncio.create_subprocess_exec(
                candidate,
                '-c',
                helper_code,
                json.dumps(dataset),
                str(target_root),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            while True:
                if await self._is_cancel_requested(job_id):
                    process.terminate()
                    try:
                        await asyncio.wait_for(process.wait(), timeout=3)
                    except asyncio.TimeoutError:
                        process.kill()
                        await process.wait()
                    raise DatasetImportCancelledError()

                if process.stdout is None:
                    break
                line = await process.stdout.readline()
                if not line:
                    break
                try:
                    payload = json.loads(line.decode().strip())
                except json.JSONDecodeError:
                    continue
                if payload.get('type') == 'progress':
                    count = int(payload.get('count', 0))
                    await self._update_job(
                        job_id,
                        status='downloading',
                        progress=min(30, 5 + count // 50),
                        stage='downloading',
                        downloadedFiles=count,
                        message=f'Đã tải và materialize {count} mẫu dataset',
                    )

            stdout, stderr = await process.communicate()
            if process.returncode == 0:
                return target_root
            last_error = stderr.decode() or stdout.decode() or f'Failed with interpreter {candidate}'

        raise RuntimeError(f'Hugging Face dataset import failed: {last_error}')

    def _format_hf_row(self, dataset_key: str, row: dict[str, Any], index: int) -> str:
        if dataset_key == 'humaneval-python':
            return '\n\n'.join(
                part for part in [
                    f"Task: {row.get('task_id', f'humaneval_{index}')}",
                    row.get('prompt', ''),
                    '# Canonical solution',
                    row.get('canonical_solution', ''),
                    '# Test',
                    row.get('test', ''),
                ] if part
            )
        if dataset_key == 'mbpp-python':
            return '\n\n'.join(
                part for part in [
                    f"Task ID: {row.get('task_id', index)}",
                    row.get('text', ''),
                    '# Code',
                    row.get('code', ''),
                    '# Tests',
                    '\n'.join(row.get('test_list', []) or []),
                    '# Challenge tests',
                    '\n'.join(row.get('challenge_test_list', []) or []),
                ] if part
            )
        if dataset_key == 'multipl-e-humaneval-cpp':
            return '\n\n'.join(
                part for part in [
                    f"Task: {row.get('name', row.get('task_id', f'humaneval_cpp_{index}'))}",
                    '# Prompt',
                    row.get('prompt', ''),
                    '# Tests',
                    row.get('tests', ''),
                    '# Original',
                    row.get('original', ''),
                    '# Entry point',
                    row.get('entry_point', ''),
                ] if part
            )
        if dataset_key == 'multipl-e-mbpp-cpp':
            return '\n\n'.join(
                part for part in [
                    f"Task: {row.get('name', row.get('task_id', f'mbpp_cpp_{index}'))}",
                    '# Prompt',
                    row.get('prompt', ''),
                    '# Tests',
                    row.get('tests', ''),
                    '# Doctests',
                    row.get('doctests', ''),
                    '# Original',
                    row.get('original', ''),
                    '# Entry point',
                    row.get('entry_point', ''),
                ] if part
            )
        if dataset_key == 'codesearchnet-python':
            return '\n\n'.join(
                part for part in [
                    row.get('docstring') or row.get('func_documentation_string') or '',
                    row.get('whole_func_string') or row.get('func_code_string') or '',
                ] if part
            )
        return json.dumps(row, ensure_ascii=False, indent=2)

    def _build_hf_file_name(self, dataset_key: str, split_name: str, index: int) -> str:
        extension = 'json'
        if dataset_key in {'humaneval-python', 'mbpp-python', 'codesearchnet-python'}:
            extension = 'py'
        if dataset_key in {'multipl-e-humaneval-cpp', 'multipl-e-mbpp-cpp'}:
            extension = 'cpp'
        return f'{dataset_key}_{split_name}_{index:06d}.{extension}'

    def _r2_grpc_target(self) -> str:
        return os.getenv('R2_SERVICE_GRPC_TARGET', '127.0.0.1:50054')

    async def _upload_artifact_to_r2(
        self,
        *,
        dataset_key: str,
        archive_path: Path,
    ) -> tuple[str, str]:
        async with grpc.aio.insecure_channel(self._r2_grpc_target()) as channel:
            stub = r2_pb2_grpc.R2ServiceStub(channel)
            response = await stub.UploadFile(
                r2_pb2.UploadFileRequest(
                    user_id='dataset-import-service',
                    filename=archive_path.name,
                    mimetype='application/zip',
                    content=archive_path.read_bytes(),
                    folder=f'dataset-imports/{dataset_key}',
                )
            )

        if not response.success:
            raise RuntimeError(response.message or 'Upload dataset artifact to R2 failed')

        artifact_key = response.key_r2 or response.file_id
        artifact_url = response.url

        if not artifact_key and artifact_url:
            parsed = urlparse(artifact_url)
            artifact_key = parsed.path.lstrip('/')

        if artifact_key and not artifact_url:
            public_base_url = os.getenv('R2_PUBLIC_URL', '').rstrip('/')
            if public_base_url:
                artifact_url = f'{public_base_url}/{artifact_key}'

        return artifact_url, artifact_key

    async def _artifact_exists_on_r2(self, artifact_key: str) -> bool:
        async with grpc.aio.insecure_channel(self._r2_grpc_target()) as channel:
            stub = r2_pb2_grpc.R2ServiceStub(channel)
            response = await stub.GetFileUrl(
                r2_pb2.GetFileUrlRequest(
                    key_r2=artifact_key,
                    expires_in_seconds=60,
                )
            )
        return bool(response.url)

    async def _archive_and_upload_dataset(
        self,
        dataset: dict[str, Any],
        source_root: Path,
        job_id: str,
    ) -> tuple[Path, str, str]:
        archive_dir = Path(tempfile.mkdtemp(prefix=f"dataset_archive_{dataset['datasetKey']}_"))
        archive_path = archive_dir / f"{dataset['datasetKey']}.zip"

        with zipfile.ZipFile(archive_path, 'w', zipfile.ZIP_DEFLATED) as zip_file:
            for path in source_root.rglob('*'):
                if path.is_file():
                    zip_file.write(path, path.relative_to(source_root))

        artifact_url, artifact_key = await self._upload_artifact_to_r2(
            dataset_key=dataset['datasetKey'],
            archive_path=archive_path,
        )
        if not artifact_url or not artifact_key:
            raise RuntimeError('R2 upload did not return artifact url/key')

        extract_root = self._job_work_root(dataset['datasetKey'], job_id) / 'content'
        if extract_root.exists():
            shutil.rmtree(extract_root, ignore_errors=True)
        extract_root.mkdir(parents=True, exist_ok=True)

        async with httpx.AsyncClient(timeout=300.0) as client:
            response = await client.get(artifact_url)
            response.raise_for_status()
            downloaded_archive = archive_dir / f"downloaded_{archive_path.name}"
            downloaded_archive.write_bytes(response.content)

        with zipfile.ZipFile(downloaded_archive, 'r') as zip_file:
            zip_file.extractall(extract_root)

        shutil.rmtree(source_root, ignore_errors=True)
        shutil.rmtree(archive_dir, ignore_errors=True)

        await self._update_job(
            job_id,
            artifactUrl=artifact_url,
            artifactKeyR2=artifact_key,
            message='Đã tải dataset lên R2 và chuẩn bị dữ liệu để ingest',
        )

        return extract_root, artifact_url, artifact_key

    async def _download_artifact_from_r2(
        self,
        *,
        dataset_key: str,
        artifact_url: str,
    ) -> Path:
        archive_dir = Path(tempfile.mkdtemp(prefix=f"dataset_reuse_{dataset_key}_"))
        archive_path = archive_dir / f"{dataset_key}.zip"
        job_id = f'reuse_{uuid4().hex[:12]}'
        extract_root = self._job_work_root(dataset_key, job_id) / 'content'
        if extract_root.exists():
            shutil.rmtree(extract_root, ignore_errors=True)
        extract_root.mkdir(parents=True, exist_ok=True)

        async with httpx.AsyncClient(timeout=300.0) as client:
            response = await client.get(artifact_url)
            response.raise_for_status()
            archive_path.write_bytes(response.content)

        with zipfile.ZipFile(archive_path, 'r') as zip_file:
            zip_file.extractall(extract_root)

        archive_path.unlink(missing_ok=True)
        return extract_root

    def _dataset_root(self) -> Path:
        return Path(__file__).resolve().parents[6] / 'data-source' / 'dataset-imports'

    def _count_supported_files(self, source_path: Path) -> int:
        return len([path for path in source_path.rglob('*') if path.is_file() and path.suffix.lower() in {'.py', '.c', '.cc', '.cpp', '.cxx', '.h', '.hpp', '.txt', '.md', '.markdown', '.pdf', '.docx'}])

    def _get_dataset(self, dataset_key: str) -> dict[str, Any]:
        for item in DATASET_CATALOG:
            if item['datasetKey'] == dataset_key:
                return item
        raise ValueError('Dataset không được hỗ trợ')

    async def _update_job(self, job_id: str, **changes: Any) -> None:
        job = await self.get_job(job_id)
        if job is None:
            return
        if 'metadata' in changes:
            changes['metadata'] = {
                **_normalize_metadata(job.get('metadata')),
                **_normalize_metadata(changes.get('metadata')),
            }
        merged = {**job, **changes, 'jobId': job_id, 'updatedAt': _utc_now().isoformat()}
        await self._upsert_job(merged)

    async def _is_cancel_requested(self, job_id: str) -> bool:
        job = await self.get_job(job_id)
        return bool(job and job.get('status') == 'cancelling')

    async def _cleanup_job(
        self,
        job_id: str,
        *,
        source_path: Optional[Path] = None,
        ingest_job_id: Optional[str] = None,
    ) -> None:
        job = await self.get_job(job_id)
        if job is None:
            return

        if ingest_job_id:
            await tutor_storage_service.delete_job_data(ingest_job_id)

        if source_path and source_path.exists():
            shutil.rmtree(source_path, ignore_errors=True)

        await self._update_job(
            job_id,
            status='cancelled',
            progress=100,
            stage='cancelled',
            message='Đã hủy job và xóa toàn bộ dữ liệu dataset đã nạp',
            completedAt=_utc_now().isoformat(),
        )

    async def _build_result_metrics(self, ingest_job_id: str) -> dict[str, int]:
        snapshot = await tutor_storage_service.fetch_job(ingest_job_id)
        if not snapshot:
            return {
                'documents': 0,
                'chunks': 0,
                'entities': 0,
                'relations': 0,
            }

        summary = snapshot.get('summary') or {}
        if isinstance(summary, str):
            try:
                summary = json.loads(summary)
            except json.JSONDecodeError:
                summary = {}

        return {
            'documents': len(snapshot.get('documents') or []),
            'chunks': int(summary.get('total_chunks', 0) or summary.get('totalChunks', 0) or 0),
            'entities': int(summary.get('total_entities', 0) or summary.get('totalEntities', 0) or 0),
            'relations': int(summary.get('total_relations', 0) or summary.get('totalRelations', 0) or 0),
        }

    async def _upsert_job(self, payload: dict[str, Any]) -> None:
        pool = await self._get_pool()
        query = """
            INSERT INTO "TutorDatasetImportJob" (
                id, "userId", "folderId", "datasetKey", title, status, progress, stage,
                message, "sourcePath", "ingestJobId", "downloadedFiles", "processedFiles", "totalFiles",
                metadata, "errorMessage", "importedFolderId", "artifactUrl", "artifactKeyR2", "createdAt", "updatedAt", "completedAt"
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8,
                $9, $10, $11, $12, $13, $14,
                $15::jsonb, $16, $17, $18, $19, $20, $21, $22
            )
            ON CONFLICT (id) DO UPDATE SET
                status = EXCLUDED.status,
                progress = EXCLUDED.progress,
                stage = EXCLUDED.stage,
                message = EXCLUDED.message,
                "sourcePath" = EXCLUDED."sourcePath",
                "ingestJobId" = EXCLUDED."ingestJobId",
                "downloadedFiles" = EXCLUDED."downloadedFiles",
                "processedFiles" = EXCLUDED."processedFiles",
                "totalFiles" = EXCLUDED."totalFiles",
                metadata = EXCLUDED.metadata,
                "errorMessage" = EXCLUDED."errorMessage",
                "importedFolderId" = EXCLUDED."importedFolderId",
                "artifactUrl" = EXCLUDED."artifactUrl",
                "artifactKeyR2" = EXCLUDED."artifactKeyR2",
                "updatedAt" = EXCLUDED."updatedAt",
                "completedAt" = EXCLUDED."completedAt"
        """
        async with pool.acquire() as conn:
            await conn.execute(
                query,
                payload['jobId'],
                payload['userId'],
                payload.get('folderId'),
                payload['datasetKey'],
                payload['title'],
                payload['status'],
                payload['progress'],
                payload['stage'],
                payload.get('message'),
                payload.get('sourcePath'),
                payload.get('ingestJobId'),
                payload.get('downloadedFiles', 0),
                payload.get('processedFiles', 0),
                payload.get('totalFiles', 0),
                json.dumps(payload.get('metadata', {})),
                payload.get('errorMessage'),
                payload.get('importedFolderId'),
                payload.get('artifactUrl'),
                payload.get('artifactKeyR2'),
                _normalize_timestamp(payload.get('createdAt') or _utc_now().isoformat()),
                _normalize_timestamp(payload.get('updatedAt') or _utc_now().isoformat()),
                _normalize_timestamp(payload.get('completedAt')),
            )

    def _map_row(self, row: asyncpg.Record) -> dict[str, Any]:
        metadata = _normalize_metadata(row['metadata'])
        return {
            'jobId': row['id'],
            'userId': row['userId'],
            'folderId': row['folderId'],
            'datasetKey': row['datasetKey'],
            'title': row['title'],
            'status': row['status'],
            'progress': row['progress'],
            'stage': row['stage'],
            'message': row['message'],
            'sourcePath': row['sourcePath'],
            'ingestJobId': row['ingestJobId'],
            'downloadedFiles': row['downloadedFiles'],
            'processedFiles': row['processedFiles'],
            'totalFiles': row['totalFiles'],
            'metadata': metadata,
            'errorMessage': row['errorMessage'],
            'importedFolderId': row['importedFolderId'],
            'artifactUrl': row['artifactUrl'],
            'artifactKeyR2': row['artifactKeyR2'],
            'createdAt': row['createdAt'].isoformat() if row['createdAt'] else None,
            'updatedAt': row['updatedAt'].isoformat() if row['updatedAt'] else None,
            'completedAt': row['completedAt'].isoformat() if row['completedAt'] else None,
        }


tutor_dataset_import_service = TutorDatasetImportService()
