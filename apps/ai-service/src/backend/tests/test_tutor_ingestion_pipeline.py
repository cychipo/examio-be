"""Checks for the tutor ingestion pipeline."""

from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path

import src.genai_tutor.knowledge_base.ingestion_pipeline as ingestion_module
from src.genai_tutor.knowledge_base.ingestion_pipeline import TutorIngestionPipeline


def test_tutor_ingest_job_processes_supported_files() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        root = Path(temp_dir)
        data_root = root / 'data-source'
        data_root.mkdir()
        source_dir = data_root / 'python-programming' / 'cs101'
        source_dir.mkdir(parents=True)
        source_file = source_dir / 'intro.py'
        source_file.write_text(
            'def greet(name):\n    return f"Hello {name}"\n\n\nclass Student:\n    pass\n',
            encoding='utf-8',
        )

        pipeline = TutorIngestionPipeline()
        original_get_allowed_roots = pipeline.get_allowed_roots
        pipeline.get_allowed_roots = lambda: [data_root]  # type: ignore[method-assign]
        original_create_job = ingestion_module.tutor_storage_service.create_job
        original_update_job = ingestion_module.tutor_storage_service.update_job
        original_upsert_document = ingestion_module.tutor_storage_service.upsert_document
        original_replace_document_chunks = ingestion_module.tutor_storage_service.replace_document_chunks
        original_get_embedding_info = ingestion_module.model_manager.get_embedding_info
        original_create_embeddings_batch = ingestion_module.get_pg_vector_store().create_embeddings_batch

        async def fake_create_job(payload):
            return None

        async def fake_update_job(payload):
            return None

        async def fake_upsert_document(payload, job_id, dataset_version):
            return None

        async def fake_replace_document_chunks(**kwargs):
            return None

        async def fake_create_embeddings_batch(texts, task_type='retrieval_document'):
            return [[0.01, 0.02, 0.03] for _ in texts]

        ingestion_module.tutor_storage_service.create_job = fake_create_job
        ingestion_module.tutor_storage_service.update_job = fake_update_job
        ingestion_module.tutor_storage_service.upsert_document = fake_upsert_document
        ingestion_module.tutor_storage_service.replace_document_chunks = fake_replace_document_chunks
        ingestion_module.model_manager.get_embedding_info = lambda: {'id': 'test-embedding'}
        ingestion_module.get_pg_vector_store().create_embeddings_batch = fake_create_embeddings_batch

        async def scenario() -> None:
            job = await pipeline.create_job(
                source_path=str(source_dir),
                triggered_by='test-suite',
                course_code='CS101',
                language='python',
                topic='functions',
                difficulty='basic',
                reindex_mode='incremental',
                license_tag='internal',
                dry_run=False,
            )

            while True:
                current = await pipeline.get_job(job.job_id)
                assert current is not None
                if current.status in {'success', 'partial_success', 'failed'}:
                    assert current.summary.total_files == 1
                    assert current.summary.processed_files == 1
                    assert current.summary.total_chunks >= 1
                    assert len(current.preview_chunks) >= 1
                    break
                await asyncio.sleep(0.05)

        try:
            asyncio.run(scenario())
        finally:
            pipeline.get_allowed_roots = original_get_allowed_roots  # type: ignore[method-assign]
            ingestion_module.tutor_storage_service.create_job = original_create_job
            ingestion_module.tutor_storage_service.update_job = original_update_job
            ingestion_module.tutor_storage_service.upsert_document = original_upsert_document
            ingestion_module.tutor_storage_service.replace_document_chunks = original_replace_document_chunks
            ingestion_module.model_manager.get_embedding_info = original_get_embedding_info
            ingestion_module.get_pg_vector_store().create_embeddings_batch = original_create_embeddings_batch


def test_tutor_ingest_rejects_outside_allowed_roots() -> None:
    pipeline = TutorIngestionPipeline()
    outside_path = Path(tempfile.gettempdir()) / 'not-allowed.txt'
    outside_path.write_text('test', encoding='utf-8')
    pipeline.get_allowed_roots = lambda: [Path(tempfile.gettempdir()) / 'allowed-only']  # type: ignore[method-assign]
    original_create_job = ingestion_module.tutor_storage_service.create_job

    async def fake_create_job(payload):
        return None

    ingestion_module.tutor_storage_service.create_job = fake_create_job

    async def scenario() -> None:
        try:
            await pipeline.create_job(
                source_path=str(outside_path),
                triggered_by='test-suite',
                course_code='CS101',
                language='python',
                topic=None,
                difficulty='basic',
                reindex_mode='incremental',
                license_tag=None,
                dry_run=True,
            )
        except ValueError as exc:
            assert 'allowed root' in str(exc)
            return

        raise AssertionError('Expected create_job to reject paths outside allowed roots')

    try:
        asyncio.run(scenario())
    finally:
        ingestion_module.tutor_storage_service.create_job = original_create_job
