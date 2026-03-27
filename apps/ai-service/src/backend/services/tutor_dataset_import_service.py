from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from uuid import uuid4

import asyncpg
import aio_pika

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
        'datasetKey': 'project-codenet',
        'title': 'Project CodeNet (C + Python)',
        'description': 'Clone đầy đủ IBM Project CodeNet, ingest toàn bộ file C/Python hỗ trợ được.',
        'source': 'git',
        'repository': 'https://github.com/IBM/Project_CodeNet.git',
        'courseCode': 'MULTI_LANG_DATASETS',
        'language': 'mixed',
        'topic': 'competitive-programming',
        'difficulty': 'intermediate',
    },
    {
        'datasetKey': 'codexglue',
        'title': 'CodeXGLUE (C + Python)',
        'description': 'Clone đầy đủ benchmark CodeXGLUE và ingest file C/Python hỗ trợ được.',
        'source': 'git',
        'repository': 'https://github.com/microsoft/CodeXGLUE.git',
        'courseCode': 'MULTI_LANG_DATASETS',
        'language': 'mixed',
        'topic': 'code-benchmark',
        'difficulty': 'intermediate',
    },
    {
        'datasetKey': 'codesearchnet-python',
        'title': 'CodeSearchNet Python',
        'description': 'CodeSearchNet Python cho semantic code search và hiểu ngữ nghĩa code.',
        'source': 'huggingface',
        'repository': 'code_search_net',
        'config': 'python',
        'courseCode': 'PYTHON_DATASETS',
        'language': 'python',
        'topic': 'semantic-code-search',
        'difficulty': 'intermediate',
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
                "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
                "completedAt" TIMESTAMP
            )
            """,
            'ALTER TABLE "TutorDatasetImportJob" ADD COLUMN IF NOT EXISTS "importedFolderId" TEXT',
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

    async def _run_job(self, job_id: str) -> None:
        job = await self.get_job(job_id)
        if job is None:
            return
        metadata = _normalize_metadata(job.get('metadata'))
        dataset = metadata.get('dataset') or self._get_dataset(job['datasetKey'])
        try:
            await self._update_job(job_id, status='downloading', progress=5, stage='downloading', message='Đang tải dataset về máy chủ')
            source_path = await self._download_dataset(dataset, job_id)
            if await self._is_cancel_requested(job_id):
                await self._cleanup_job(job_id, source_path=source_path)
                return

            total_files = self._count_supported_files(source_path)
            await self._update_job(
                job_id,
                status='processing',
                progress=35,
                stage='ingesting',
                sourcePath=str(source_path),
                downloadedFiles=total_files,
                totalFiles=total_files,
                message='Đang đưa dataset vào pipeline GraphRAG',
            )

            ingest_job = await tutor_ingestion_pipeline.create_job(
                source_path=str(source_path),
                triggered_by=f'dataset-import:{dataset["datasetKey"]}',
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

    async def _download_dataset(self, dataset: dict[str, Any], job_id: str) -> Path:
        target_root = self._dataset_root() / dataset['datasetKey']
        if target_root.exists():
            shutil.rmtree(target_root)
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
            return target_root

        if dataset['source'] == 'huggingface':
            return await self._materialize_huggingface_dataset(dataset, target_root, job_id)

        raise ValueError(f'Unsupported dataset source: {dataset["source"]}')

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
        return f'{dataset_key}_{split_name}_{index:06d}.{extension}'

    def _dataset_root(self) -> Path:
        return Path(__file__).resolve().parents[6] / 'data-source' / 'dataset-imports'

    def _count_supported_files(self, source_path: Path) -> int:
        return len([path for path in source_path.rglob('*') if path.is_file() and path.suffix.lower() in {'.py', '.c', '.h', '.txt', '.md', '.markdown', '.pdf', '.docx'}])

    def _get_dataset(self, dataset_key: str) -> dict[str, Any]:
        for item in DATASET_CATALOG:
            if item['datasetKey'] == dataset_key:
                return item
        raise ValueError('Dataset không được hỗ trợ')

    async def _update_job(self, job_id: str, **changes: Any) -> None:
        job = await self.get_job(job_id)
        if job is None:
            return
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
                metadata, "errorMessage", "importedFolderId", "createdAt", "updatedAt", "completedAt"
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8,
                $9, $10, $11, $12, $13, $14,
                $15::jsonb, $16, $17, $18, $19, $20
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
            'createdAt': row['createdAt'].isoformat() if row['createdAt'] else None,
            'updatedAt': row['updatedAt'].isoformat() if row['updatedAt'] else None,
            'completedAt': row['completedAt'].isoformat() if row['completedAt'] else None,
        }


tutor_dataset_import_service = TutorDatasetImportService()
