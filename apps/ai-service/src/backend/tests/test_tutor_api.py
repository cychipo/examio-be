"""API-level checks for tutor endpoints with lightweight stubs."""

from __future__ import annotations

from fastapi.testclient import TestClient

import src.backend.api.tutor as tutor_api
from src.backend.main import app


def test_tutor_query_returns_answer_with_stubbed_dependencies() -> None:
    client = TestClient(app)

    original_resolve_model = tutor_api.model_manager.resolve_model
    original_create_embedding = tutor_api.get_pg_vector_store().create_embedding
    original_search_chunks = tutor_api.tutor_storage_service.search_chunks
    original_get_graph_facts = tutor_api.tutor_storage_service.get_graph_facts
    original_chat = tutor_api.SimpleChatAgent.chat

    class ResolvedModel:
        id = 'qwen3_8b'

    class RetrievedChunk:
        chunk_id = 'chk_1'
        document_id = 'doc_1'
        dataset_version = 'cs101-python-v1'
        content = 'def greet(name): return name'
        content_type = 'code'
        language = 'python'
        topic = 'functions'
        difficulty = 'basic'
        source_path = 'data-source/python-programming/cs101/intro.py'
        title = 'intro.py'
        chunk_index = 0
        similarity_score = 0.91

    class GraphFact:
        entity_name = 'greet'
        entity_type = 'CodeEntity'
        relation_type = 'calls'
        related_entity_name = 'print'
        weight = 0.8

    async def fake_create_embedding(query, task_type='retrieval_query'):
        return [0.1, 0.2, 0.3]

    async def fake_search_chunks(**kwargs):
        return [RetrievedChunk()]

    async def fake_get_graph_facts(**kwargs):
        return [GraphFact()]

    def fake_chat(self, message: str) -> str:
        return 'Stubbed tutor answer'

    tutor_api.model_manager.resolve_model = lambda model_id=None: ResolvedModel()  # type: ignore[method-assign]
    tutor_api.get_pg_vector_store().create_embedding = fake_create_embedding  # type: ignore[method-assign]
    tutor_api.tutor_storage_service.search_chunks = fake_search_chunks  # type: ignore[method-assign]
    tutor_api.tutor_storage_service.get_graph_facts = fake_get_graph_facts  # type: ignore[method-assign]
    tutor_api.SimpleChatAgent.chat = fake_chat  # type: ignore[method-assign]

    try:
        response = client.post(
            '/api/tutor/query',
            json={
                'query': 'Ham greet dung de lam gi?',
                'courseCode': 'CS101',
                'language': 'python',
                'topic': 'functions',
                'difficulty': 'basic',
                'topK': 3,
            },
        )
        assert response.status_code == 200
        body = response.json()
        assert body['answer'] == 'Stubbed tutor answer'
        assert body['retrievalCount'] == 1
        assert body['sources'][0]['chunkId'] == 'chk_1'
    finally:
        tutor_api.model_manager.resolve_model = original_resolve_model  # type: ignore[method-assign]
        tutor_api.get_pg_vector_store().create_embedding = original_create_embedding  # type: ignore[method-assign]
        tutor_api.tutor_storage_service.search_chunks = original_search_chunks  # type: ignore[method-assign]
        tutor_api.tutor_storage_service.get_graph_facts = original_get_graph_facts  # type: ignore[method-assign]
        tutor_api.SimpleChatAgent.chat = original_chat  # type: ignore[method-assign]


def test_tutor_stream_returns_sse_done_event() -> None:
    client = TestClient(app)

    original_resolve_model = tutor_api.model_manager.resolve_model
    original_create_embedding = tutor_api.get_pg_vector_store().create_embedding
    original_search_chunks = tutor_api.tutor_storage_service.search_chunks
    original_get_graph_facts = tutor_api.tutor_storage_service.get_graph_facts
    original_chat_stream = tutor_api.SimpleChatAgent.chat_stream

    class ResolvedModel:
        id = 'qwen3_8b'

    class RetrievedChunk:
        chunk_id = 'chk_1'
        document_id = 'doc_1'
        dataset_version = 'cs101-python-v1'
        content = 'print("hello")'
        content_type = 'code'
        language = 'python'
        topic = 'io'
        difficulty = 'basic'
        source_path = 'data-source/python-programming/cs101/io.py'
        title = 'io.py'
        chunk_index = 0
        similarity_score = 0.88

    async def fake_create_embedding(query, task_type='retrieval_query'):
        return [0.1, 0.2, 0.3]

    async def fake_search_chunks(**kwargs):
        return [RetrievedChunk()]

    async def fake_get_graph_facts(**kwargs):
        return []

    def fake_chat_stream(self, message: str, history=None):
        yield 'phan 1 '
        yield 'phan 2'

    tutor_api.model_manager.resolve_model = lambda model_id=None: ResolvedModel()  # type: ignore[method-assign]
    tutor_api.get_pg_vector_store().create_embedding = fake_create_embedding  # type: ignore[method-assign]
    tutor_api.tutor_storage_service.search_chunks = fake_search_chunks  # type: ignore[method-assign]
    tutor_api.tutor_storage_service.get_graph_facts = fake_get_graph_facts  # type: ignore[method-assign]
    tutor_api.SimpleChatAgent.chat_stream = fake_chat_stream  # type: ignore[method-assign]

    try:
        response = client.post(
            '/api/tutor/stream',
            json={
                'query': 'In ra man hinh nhu the nao?',
                'courseCode': 'CS101',
            },
        )
        assert response.status_code == 200
        assert '"type": "done"' in response.text
        assert 'phan 1 phan 2' in response.text
    finally:
        tutor_api.model_manager.resolve_model = original_resolve_model  # type: ignore[method-assign]
        tutor_api.get_pg_vector_store().create_embedding = original_create_embedding  # type: ignore[method-assign]
        tutor_api.tutor_storage_service.search_chunks = original_search_chunks  # type: ignore[method-assign]
        tutor_api.tutor_storage_service.get_graph_facts = original_get_graph_facts  # type: ignore[method-assign]
        tutor_api.SimpleChatAgent.chat_stream = original_chat_stream  # type: ignore[method-assign]


def test_tutor_graph_job_snapshot_endpoint() -> None:
    client = TestClient(app)

    original_get_graph_snapshot_by_job = tutor_api.tutor_storage_service.get_graph_snapshot_by_job

    async def fake_get_graph_snapshot_by_job(job_id: str):
        return {
            'jobId': job_id,
            'documents': [{'id': 'doc_1', 'title': 'intro.py', 'sourcePath': 'data-source/python-programming/cs101/intro.py'}],
            'entities': [{'id': 'entity_1', 'name': 'greet'}],
            'relations': [{'id': 'rel_1', 'from_name': 'greet', 'to_name': 'print'}],
        }

    tutor_api.tutor_storage_service.get_graph_snapshot_by_job = fake_get_graph_snapshot_by_job  # type: ignore[method-assign]

    try:
        response = client.get('/api/tutor/graph/job/job_123')
        assert response.status_code == 200
        body = response.json()
        assert body['jobId'] == 'job_123'
        assert body['documents'][0]['id'] == 'doc_1'
    finally:
        tutor_api.tutor_storage_service.get_graph_snapshot_by_job = original_get_graph_snapshot_by_job  # type: ignore[method-assign]


def test_tutor_graph_document_snapshot_endpoint() -> None:
    client = TestClient(app)

    original_get_graph_snapshot_by_document = tutor_api.tutor_storage_service.get_graph_snapshot_by_document

    async def fake_get_graph_snapshot_by_document(document_id: str):
        return {
            'document': {'id': document_id, 'title': 'intro.py', 'sourcePath': 'data-source/python-programming/cs101/intro.py'},
            'entities': [{'id': 'entity_1', 'name': 'greet'}],
            'relations': [{'id': 'rel_1', 'from_name': 'greet', 'to_name': 'print'}],
        }

    tutor_api.tutor_storage_service.get_graph_snapshot_by_document = fake_get_graph_snapshot_by_document  # type: ignore[method-assign]

    try:
        response = client.get('/api/tutor/graph/document/doc_123')
        assert response.status_code == 200
        body = response.json()
        assert body['document']['id'] == 'doc_123'
        assert body['entities'][0]['name'] == 'greet'
    finally:
        tutor_api.tutor_storage_service.get_graph_snapshot_by_document = original_get_graph_snapshot_by_document  # type: ignore[method-assign]
