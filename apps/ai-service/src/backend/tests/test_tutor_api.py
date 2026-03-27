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
    original_search_chunks_hybrid = tutor_api.tutor_storage_service.search_chunks_hybrid
    original_get_graph_facts = tutor_api.tutor_storage_service.get_graph_facts
    original_get_graph_neighbors = tutor_api.tutor_storage_service.get_graph_neighbors
    original_chat = tutor_api.SimpleChatAgent.chat
    original_init = tutor_api.SimpleChatAgent.__init__

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

    async def fake_get_graph_neighbors(**kwargs):
        return []

    def fake_init(self, pre_context: str, model_type: str, system_prompt: str) -> None:
        self.pre_context = pre_context
        self.model_type = model_type
        self.system_prompt = system_prompt

    def fake_chat(self, message: str) -> str:
        return 'Stubbed tutor answer'

    tutor_api.model_manager.resolve_model = lambda model_id=None: ResolvedModel()  # type: ignore[method-assign]
    tutor_api.get_pg_vector_store().create_embedding = fake_create_embedding  # type: ignore[method-assign]
    tutor_api.tutor_storage_service.search_chunks = fake_search_chunks  # type: ignore[method-assign]
    tutor_api.tutor_storage_service.search_chunks_hybrid = fake_search_chunks  # type: ignore[method-assign]
    tutor_api.tutor_storage_service.get_graph_facts = fake_get_graph_facts  # type: ignore[method-assign]
    tutor_api.tutor_storage_service.get_graph_neighbors = fake_get_graph_neighbors  # type: ignore[method-assign]
    tutor_api.SimpleChatAgent.__init__ = fake_init  # type: ignore[method-assign]
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
        tutor_api.tutor_storage_service.search_chunks_hybrid = original_search_chunks_hybrid  # type: ignore[method-assign]
        tutor_api.tutor_storage_service.get_graph_facts = original_get_graph_facts  # type: ignore[method-assign]
        tutor_api.tutor_storage_service.get_graph_neighbors = original_get_graph_neighbors  # type: ignore[method-assign]
        tutor_api.SimpleChatAgent.__init__ = original_init  # type: ignore[method-assign]
        tutor_api.SimpleChatAgent.chat = original_chat  # type: ignore[method-assign]


def test_tutor_stream_returns_sse_done_event() -> None:
    client = TestClient(app)

    original_resolve_model = tutor_api.model_manager.resolve_model
    original_create_embedding = tutor_api.get_pg_vector_store().create_embedding
    original_search_chunks = tutor_api.tutor_storage_service.search_chunks
    original_search_chunks_hybrid = tutor_api.tutor_storage_service.search_chunks_hybrid
    original_get_graph_facts = tutor_api.tutor_storage_service.get_graph_facts
    original_get_graph_neighbors = tutor_api.tutor_storage_service.get_graph_neighbors
    original_chat_stream = tutor_api.SimpleChatAgent.chat_stream
    original_init = tutor_api.SimpleChatAgent.__init__

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

    async def fake_get_graph_neighbors(**kwargs):
        return []

    def fake_init(self, pre_context: str, model_type: str, system_prompt: str) -> None:
        self.pre_context = pre_context
        self.model_type = model_type
        self.system_prompt = system_prompt

    def fake_chat_stream(self, message: str, history=None):
        yield 'phan 1 '
        yield 'phan 2'

    tutor_api.model_manager.resolve_model = lambda model_id=None: ResolvedModel()  # type: ignore[method-assign]
    tutor_api.get_pg_vector_store().create_embedding = fake_create_embedding  # type: ignore[method-assign]
    tutor_api.tutor_storage_service.search_chunks = fake_search_chunks  # type: ignore[method-assign]
    tutor_api.tutor_storage_service.search_chunks_hybrid = fake_search_chunks  # type: ignore[method-assign]
    tutor_api.tutor_storage_service.get_graph_facts = fake_get_graph_facts  # type: ignore[method-assign]
    tutor_api.tutor_storage_service.get_graph_neighbors = fake_get_graph_neighbors  # type: ignore[method-assign]
    tutor_api.SimpleChatAgent.__init__ = fake_init  # type: ignore[method-assign]
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
        tutor_api.tutor_storage_service.search_chunks_hybrid = original_search_chunks_hybrid  # type: ignore[method-assign]
        tutor_api.tutor_storage_service.get_graph_facts = original_get_graph_facts  # type: ignore[method-assign]
        tutor_api.tutor_storage_service.get_graph_neighbors = original_get_graph_neighbors  # type: ignore[method-assign]
        tutor_api.SimpleChatAgent.__init__ = original_init  # type: ignore[method-assign]
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


def test_create_tutor_knowledge_file_returns_graph_metadata() -> None:
    client = TestClient(app)

    original_create_file = tutor_api.tutor_knowledge_storage_service.create_file
    original_enqueue = tutor_api.tutor_knowledge_file_worker.enqueue
    original_getenv = tutor_api.os.getenv

    async def fake_create_file(payload):
        return None

    captured_payload = {}

    def fake_enqueue(payload):
        captured_payload.update(payload)

    tutor_api.tutor_knowledge_storage_service.create_file = fake_create_file  # type: ignore[method-assign]
    tutor_api.tutor_knowledge_file_worker.enqueue = fake_enqueue  # type: ignore[method-assign]
    tutor_api.os.getenv = lambda key, default=None: None if key == 'RABBITMQ_URL' else original_getenv(key, default)  # type: ignore[method-assign]

    try:
        response = client.post(
            '/api/tutor/knowledge-files',
            json={
                'fileId': 'file_123',
                'userId': 'user_123',
                'filename': 'dataset.json',
                'description': 'JSON knowledge dataset',
                'url': 'https://example.com/dataset.json',
                'keyR2': 'r2-key',
                'mimeType': 'application/json',
                'size': 2048,
            },
        )
        assert response.status_code == 200
        body = response.json()
        assert body['fileId'] == 'file_123'
        assert body['metadata']['stage'] == 'queued'
        assert body['metadata']['graphStage'] == 'queued'
        assert body['metadata']['sourceType'] == 'json'
        assert captured_payload['sourceType'] == 'json'
    finally:
        tutor_api.tutor_knowledge_storage_service.create_file = original_create_file  # type: ignore[method-assign]
        tutor_api.tutor_knowledge_file_worker.enqueue = original_enqueue  # type: ignore[method-assign]
        tutor_api.os.getenv = original_getenv  # type: ignore[method-assign]


def test_get_tutor_knowledge_file_graph_endpoint() -> None:
    client = TestClient(app)

    original_get_file = tutor_api.tutor_knowledge_storage_service.get_file
    original_get_graph_snapshot = tutor_api.tutor_storage_service.get_graph_snapshot_by_document

    async def fake_get_file(file_id: str):
        return {
            'fileId': file_id,
            'graphDocumentId': 'doc_graph_123',
        }

    async def fake_get_graph_snapshot(document_id: str):
        return {
            'document': {'id': document_id, 'title': 'dataset.json', 'sourcePath': 'dataset.json'},
            'entities': [{'id': 'entity_1', 'name': 'Python Basics'}],
            'relations': [{'id': 'rel_1', 'relationType': 'has_chapters', 'from_name': 'python_basics', 'to_name': 'variables', 'weight': 1.0}],
        }

    tutor_api.tutor_knowledge_storage_service.get_file = fake_get_file  # type: ignore[method-assign]
    tutor_api.tutor_storage_service.get_graph_snapshot_by_document = fake_get_graph_snapshot  # type: ignore[method-assign]

    try:
        response = client.get('/api/tutor/knowledge-files/file_123/graph')
        assert response.status_code == 200
        body = response.json()
        assert body['document']['id'] == 'doc_graph_123'
        assert body['entities'][0]['name'] == 'Python Basics'
    finally:
        tutor_api.tutor_knowledge_storage_service.get_file = original_get_file  # type: ignore[method-assign]
        tutor_api.tutor_storage_service.get_graph_snapshot_by_document = original_get_graph_snapshot  # type: ignore[method-assign]


def test_create_tutor_dataset_import_job_endpoint() -> None:
    client = TestClient(app)

    original_create_job = tutor_api.tutor_dataset_import_service.create_job

    async def fake_create_job(*, user_id: str, folder_id: str | None, dataset_key: str):
        return {
            'jobId': 'dataset_import_123',
            'datasetKey': dataset_key,
            'status': 'queued',
            'progress': 0,
            'stage': 'queued',
            'message': 'Đã tạo job',
        }

    tutor_api.tutor_dataset_import_service.create_job = fake_create_job  # type: ignore[method-assign]

    try:
        response = client.post(
            '/api/tutor/dataset-imports',
            json={
                'userId': 'teacher_1',
                'folderId': 'folder_1',
                'datasetKey': 'humaneval-python',
            },
        )
        assert response.status_code == 200
        body = response.json()
        assert body['jobId'] == 'dataset_import_123'
        assert body['datasetKey'] == 'humaneval-python'
        assert body['stage'] == 'queued'
    finally:
        tutor_api.tutor_dataset_import_service.create_job = original_create_job  # type: ignore[method-assign]


def test_cancel_tutor_dataset_import_job_endpoint() -> None:
    client = TestClient(app)

    original_cancel_job = tutor_api.tutor_dataset_import_service.cancel_job

    async def fake_cancel_job(job_id: str):
        return {
            'jobId': job_id,
            'datasetKey': 'humaneval-python',
            'status': 'cancel_requested',
            'progress': 100,
            'stage': 'cancel_requested',
            'message': 'Đã nhận yêu cầu hủy',
        }

    tutor_api.tutor_dataset_import_service.cancel_job = fake_cancel_job  # type: ignore[method-assign]

    try:
        response = client.post('/api/tutor/dataset-imports/dataset_import_123/cancel')
        assert response.status_code == 200
        body = response.json()
        assert body['jobId'] == 'dataset_import_123'
        assert body['status'] == 'cancel_requested'
    finally:
        tutor_api.tutor_dataset_import_service.cancel_job = original_cancel_job  # type: ignore[method-assign]
