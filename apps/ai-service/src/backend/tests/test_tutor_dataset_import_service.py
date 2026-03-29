from __future__ import annotations

import asyncio
from pathlib import Path

import src.backend.services.tutor_dataset_import_service as service_module
from src.backend.services.tutor_dataset_import_service import (
    DATASET_CATALOG,
    tutor_dataset_import_service,
)


def test_dataset_import_jobs_use_isolated_trigger_ids() -> None:
    original_get_job = tutor_dataset_import_service.get_job
    original_update_job = tutor_dataset_import_service._update_job
    original_download_dataset = tutor_dataset_import_service._download_dataset
    original_is_cancel_requested = tutor_dataset_import_service._is_cancel_requested
    original_find_reusable = tutor_dataset_import_service._find_reusable_artifact_job
    original_count_supported_files = tutor_dataset_import_service._count_supported_files
    original_pipeline = service_module.tutor_ingestion_pipeline
    original_storage_fetch_job = service_module.tutor_storage_service.fetch_job

    class FakeIngestionPipeline:
        def __init__(self) -> None:
            self.calls: list[dict] = []

        async def create_job(self, **kwargs):
            self.calls.append(kwargs)

            class Job:
                job_id = f"ingest_for_{kwargs['triggered_by'].split(':')[-1]}"

            return Job()

    fake_pipeline = FakeIngestionPipeline()

    async def fake_get_job(job_id: str):
        return {
            'jobId': job_id,
            'userId': 'teacher_1',
            'folderId': 'folder_1',
            'datasetKey': 'humaneval-python',
            'metadata': {'dataset': tutor_dataset_import_service._get_dataset('humaneval-python')},
        }

    async def fake_update_job(job_id: str, **changes):
        return None

    async def fake_download_dataset(dataset, job_id: str):
        return Path('/Users/tgiap.dev/devs/kma-edu/data-source/dataset-imports/humaneval-python') / job_id / 'content', 'https://example.com/a.zip', 'dataset-imports/humaneval-python/a.zip'

    async def fake_is_cancel_requested(job_id: str):
        return False

    async def fake_find_reusable_artifact_job(user_id: str, dataset_key: str, *, exclude_job_id: str):
        return None

    async def fake_storage_fetch_job(job_id: str):
        return {
            'status': 'success',
            'summary': {
                'processed_files': 1,
                'total_files': 1,
                'total_chunks': 2,
                'total_entities': 3,
                'total_relations': 1,
            },
            'documents': [{'id': 'doc_1'}],
        }

    tutor_dataset_import_service.get_job = fake_get_job  # type: ignore[method-assign]
    tutor_dataset_import_service._update_job = fake_update_job  # type: ignore[method-assign]
    tutor_dataset_import_service._download_dataset = fake_download_dataset  # type: ignore[method-assign]
    tutor_dataset_import_service._is_cancel_requested = fake_is_cancel_requested  # type: ignore[method-assign]
    tutor_dataset_import_service._find_reusable_artifact_job = fake_find_reusable_artifact_job  # type: ignore[method-assign]
    tutor_dataset_import_service._count_supported_files = lambda _source_path: 1  # type: ignore[method-assign]
    service_module.tutor_ingestion_pipeline = fake_pipeline  # type: ignore[assignment]
    service_module.tutor_storage_service.fetch_job = fake_storage_fetch_job  # type: ignore[method-assign]

    async def scenario() -> None:
        await tutor_dataset_import_service._run_job('dataset_import_job_a')
        await tutor_dataset_import_service._run_job('dataset_import_job_b')

    try:
        asyncio.run(scenario())
        assert len(fake_pipeline.calls) == 2
        assert fake_pipeline.calls[0]['triggered_by'] == 'dataset-import:humaneval-python:dataset_import_job_a'
        assert fake_pipeline.calls[1]['triggered_by'] == 'dataset-import:humaneval-python:dataset_import_job_b'
    finally:
        tutor_dataset_import_service.get_job = original_get_job  # type: ignore[method-assign]
        tutor_dataset_import_service._update_job = original_update_job  # type: ignore[method-assign]
        tutor_dataset_import_service._download_dataset = original_download_dataset  # type: ignore[method-assign]
        tutor_dataset_import_service._is_cancel_requested = original_is_cancel_requested  # type: ignore[method-assign]
        tutor_dataset_import_service._find_reusable_artifact_job = original_find_reusable  # type: ignore[method-assign]
        tutor_dataset_import_service._count_supported_files = original_count_supported_files  # type: ignore[method-assign]
        service_module.tutor_ingestion_pipeline = original_pipeline  # type: ignore[assignment]
        service_module.tutor_storage_service.fetch_job = original_storage_fetch_job  # type: ignore[method-assign]


def test_clear_dataset_uses_dataset_prefix_only() -> None:
    deleted_triggers: list[str] = []
    deleted_benchmark_datasets: list[str] = []

    original_get_existing = tutor_dataset_import_service.get_existing_dataset_import
    original_get_pool = tutor_dataset_import_service._get_pool
    original_delete_jobs = service_module.tutor_storage_service.delete_jobs_by_trigger
    original_delete_benchmarks = service_module.benchmark_index_service.delete_items_by_dataset_name

    async def fake_get_existing_dataset_import(*, user_id: str, dataset_key: str):
        return {
            'datasetKey': dataset_key,
            'status': 'completed',
        }

    class FakeConn:
        async def execute(self, *_args, **_kwargs):
            return None

    class FakeAcquire:
        async def __aenter__(self):
            return FakeConn()

        async def __aexit__(self, exc_type, exc, tb):
            return False

    class FakePool:
        def acquire(self):
            return FakeAcquire()

    async def fake_get_pool():
        return FakePool()

    async def fake_delete_jobs_by_trigger(trigger: str):
        deleted_triggers.append(trigger)

    async def fake_delete_items_by_dataset_name(dataset_name: str):
        deleted_benchmark_datasets.append(dataset_name)
        return 2

    tutor_dataset_import_service.get_existing_dataset_import = fake_get_existing_dataset_import  # type: ignore[method-assign]
    tutor_dataset_import_service._get_pool = fake_get_pool  # type: ignore[method-assign]
    service_module.tutor_storage_service.delete_jobs_by_trigger = fake_delete_jobs_by_trigger  # type: ignore[method-assign]
    service_module.benchmark_index_service.delete_items_by_dataset_name = fake_delete_items_by_dataset_name  # type: ignore[method-assign]

    async def scenario() -> None:
        result = await tutor_dataset_import_service.clear_dataset(
            user_id='teacher_1',
            dataset_key='humaneval-python',
        )
        assert result['success'] is True

    try:
        asyncio.run(scenario())
        assert deleted_triggers == ['dataset-import:humaneval-python:%']
        assert deleted_benchmark_datasets == ['humaneval']
    finally:
        tutor_dataset_import_service.get_existing_dataset_import = original_get_existing  # type: ignore[method-assign]
        tutor_dataset_import_service._get_pool = original_get_pool  # type: ignore[method-assign]
        service_module.tutor_storage_service.delete_jobs_by_trigger = original_delete_jobs  # type: ignore[method-assign]
        service_module.benchmark_index_service.delete_items_by_dataset_name = original_delete_benchmarks  # type: ignore[method-assign]


def test_update_job_preserves_existing_metadata_fields() -> None:
    original_get_job = tutor_dataset_import_service.get_job
    original_upsert_job = tutor_dataset_import_service._upsert_job

    captured_payloads: list[dict] = []

    async def fake_get_job(job_id: str):
        return {
            'jobId': job_id,
            'userId': 'teacher_1',
            'folderId': 'folder_1',
            'datasetKey': 'humaneval-python',
            'title': 'HumanEval Python',
            'status': 'processing',
            'progress': 35,
            'stage': 'graphing',
            'message': 'Đang xử lý',
            'sourcePath': '/tmp/source',
            'ingestJobId': 'ingest_1',
            'downloadedFiles': 10,
            'processedFiles': 10,
            'totalFiles': 10,
            'metadata': {
                'dataset': {'datasetKey': 'humaneval-python'},
                'benchmarkIndexing': {'seeded': 164, 'parsed': 164},
            },
            'errorMessage': None,
            'importedFolderId': 'folder_1',
            'artifactUrl': 'https://example.com/a.zip',
            'artifactKeyR2': 'dataset-imports/humaneval-python/a.zip',
            'createdAt': '2026-03-29T00:00:00+00:00',
            'updatedAt': '2026-03-29T00:00:00+00:00',
            'completedAt': None,
        }

    async def fake_upsert_job(payload: dict):
        captured_payloads.append(payload)

    tutor_dataset_import_service.get_job = fake_get_job  # type: ignore[method-assign]
    tutor_dataset_import_service._upsert_job = fake_upsert_job  # type: ignore[method-assign]

    async def scenario() -> None:
        await tutor_dataset_import_service._update_job(
            'dataset_import_job_a',
            status='completed',
            metadata={
                'result': {
                    'documents': 1,
                    'chunks': 2,
                    'entities': 3,
                    'relations': 4,
                }
            },
        )

    try:
        asyncio.run(scenario())
        assert len(captured_payloads) == 1
        assert captured_payloads[0]['metadata']['benchmarkIndexing'] == {
            'seeded': 164,
            'parsed': 164,
        }
        assert captured_payloads[0]['metadata']['result'] == {
            'documents': 1,
            'chunks': 2,
            'entities': 3,
            'relations': 4,
        }
    finally:
        tutor_dataset_import_service.get_job = original_get_job  # type: ignore[method-assign]
        tutor_dataset_import_service._upsert_job = original_upsert_job  # type: ignore[method-assign]


def test_list_dataset_states_ignores_completed_jobs_with_deleted_folder() -> None:
    original_list_jobs = tutor_dataset_import_service.list_jobs
    original_get_pool = tutor_dataset_import_service._get_pool

    async def fake_list_jobs(user_id: str):
        assert user_id == 'teacher_1'
        return [
            {
                'jobId': 'dataset_import_1',
                'datasetKey': 'humaneval-python',
                'status': 'completed',
                'folderId': 'missing-folder',
                'importedFolderId': 'missing-folder',
                'completedAt': '2026-03-29T00:00:00+00:00',
            }
        ]

    class FakeConn:
        async def fetch(self, query: str, user_id: str):
            assert 'TutorKnowledgeFolder' in query
            assert user_id == 'teacher_1'
            return []

    class FakeAcquire:
        async def __aenter__(self):
            return FakeConn()

        async def __aexit__(self, exc_type, exc, tb):
            return False

    class FakePool:
        def acquire(self):
            return FakeAcquire()

    async def fake_get_pool():
        return FakePool()

    tutor_dataset_import_service.list_jobs = fake_list_jobs  # type: ignore[method-assign]
    tutor_dataset_import_service._get_pool = fake_get_pool  # type: ignore[method-assign]

    try:
        states = asyncio.run(tutor_dataset_import_service.list_dataset_states('teacher_1'))
        humaneval_state = next(state for state in states if state['datasetKey'] == 'humaneval-python')
        assert humaneval_state['imported'] is False
        assert humaneval_state['importedFolderId'] is None
        assert humaneval_state['lastSuccessfulJob'] is None
    finally:
        tutor_dataset_import_service.list_jobs = original_list_jobs  # type: ignore[method-assign]
        tutor_dataset_import_service._get_pool = original_get_pool  # type: ignore[method-assign]


def test_dataset_catalog_includes_supported_benchmarks() -> None:
    dataset_keys = {item['datasetKey'] for item in DATASET_CATALOG}
    assert dataset_keys == {
        'humaneval-python',
        'mbpp-python',
        'multipl-e-humaneval-cpp',
        'multipl-e-mbpp-cpp',
    }


def test_benchmark_dataset_mapping_supports_cpp_datasets() -> None:
    assert tutor_dataset_import_service._benchmark_dataset_name_for_dataset_key('multipl-e-humaneval-cpp') == 'multipl_e_humaneval_cpp'
    assert tutor_dataset_import_service._benchmark_dataset_name_for_dataset_key('multipl-e-mbpp-cpp') == 'multipl_e_mbpp_cpp'


def test_load_materialized_humaneval_cpp_samples() -> None:
    import tempfile

    with tempfile.TemporaryDirectory() as tmp_dir:
        root = Path(tmp_dir)
        sample_file = root / 'multipl-e-humaneval-cpp_test_000001.cpp'
        sample_file.write_text(
            '\n\n'.join([
                'Task: HumanEvalCpp/1',
                '# Prompt',
                'std::vector<int> two_sum(std::vector<int> nums, int target);',
                '# Tests',
                'int main() { return 0; }',
                '# Original',
                'std::vector<int> two_sum(std::vector<int> nums, int target) { return {}; }',
                '# Entry point',
                'two_sum',
            ]),
            encoding='utf-8',
        )

        samples = tutor_dataset_import_service._load_materialized_humaneval_cpp_samples(root)

        assert len(samples) == 1
        assert samples[0].sample_id == 'HumanEvalCpp/1'
        assert samples[0].dataset_name == 'multipl_e_humaneval_cpp'
        assert samples[0].language == 'cpp'
        assert samples[0].entry_point == 'two_sum'
        assert samples[0].test_code == 'int main() { return 0; }'


def test_load_materialized_mbpp_cpp_samples() -> None:
    import tempfile

    with tempfile.TemporaryDirectory() as tmp_dir:
        root = Path(tmp_dir)
        sample_file = root / 'multipl-e-mbpp-cpp_test_000001.cpp'
        sample_file.write_text(
            '\n\n'.join([
                'Task: 11',
                '# Prompt',
                'Write a C++ function sum_values that returns the total.',
                '# Tests',
                'int main() { return sum_values({1,2,3}) == 6 ? 0 : 1; }',
                '# Doctests',
                '// sample doctest',
                '# Original',
                'int sum_values(std::vector<int> values) { return 6; }',
                '# Entry point',
                'sum_values',
            ]),
            encoding='utf-8',
        )

        samples = tutor_dataset_import_service._load_materialized_mbpp_cpp_samples(root)

        assert len(samples) == 1
        assert samples[0].sample_id == 'mbpp_cpp_11'
        assert samples[0].dataset_name == 'multipl_e_mbpp_cpp'
        assert samples[0].language == 'cpp'
        assert samples[0].entry_point == 'sum_values'
        assert 'sample doctest' in samples[0].test_code


def test_count_supported_files_includes_c_sources() -> None:
    import tempfile

    with tempfile.TemporaryDirectory() as tmp_dir:
        root = Path(tmp_dir)
        (root / 'sample.c').write_text('int main(void) { return 0; }', encoding='utf-8')
        (root / 'sample.cpp').write_text('int main() { return 0; }', encoding='utf-8')
        (root / 'note.txt').write_text('ignored helper text', encoding='utf-8')

        count = tutor_dataset_import_service._count_supported_files(root)

        assert count == 3
