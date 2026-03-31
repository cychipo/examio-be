"""Tutor-specific API endpoints."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

import aio_pika
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from src.llm.model_manager import ModelUnavailableError, model_manager
from src.backend.services.tutor_knowledge_storage_service import (
    tutor_knowledge_storage_service,
)
from src.backend.services.tutor_dataset_import_service import (
    tutor_dataset_import_service,
)
from src.backend.services.student_programming_chat_service import (
    student_programming_chat_service,
)
from src.backend.services.student_programming_evaluation_service import (
    student_programming_evaluation_service,
)
from src.rag.simple_chat_agent import SimpleChatAgent
from src.backend.services.tutor_storage_service import tutor_storage_service
from src.genai_tutor.knowledge_base.knowledge_file_worker import (
    tutor_knowledge_file_worker,
)
from src.genai_tutor.knowledge_base.ingestion_pipeline import (
    tutor_ingestion_pipeline,
)
from src.rag.vector_store_pg import get_pg_vector_store

logger = logging.getLogger(__name__)

router = APIRouter()


camel_model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)
_TUTOR_CONTEXT_CACHE_TTL_SECONDS = 45.0
_TUTOR_CONTEXT_CACHE_MAX_SIZE = 64
_tutor_context_cache: dict[str, tuple[float, tuple[str, list[dict[str, Any]], float]]] = {}


class TutorIngestRequest(BaseModel):
    model_config = camel_model_config

    source_path: str = Field(..., description='Folder or file path under allowed data-source root')
    course_code: str = Field(..., min_length=2, max_length=50)
    language: str | None = Field(default=None, description='Target language such as c or python')
    topic: str | None = Field(default=None, max_length=100)
    difficulty: Literal['basic', 'intermediate', 'advanced'] | None = None
    reindex_mode: Literal['incremental', 'full', 'graph-only', 'embedding-only'] = Field(
        default='incremental',
        alias='reindexMode',
    )
    license_tag: str | None = Field(default=None, max_length=100)
    dry_run: bool = False
    triggered_by: str = Field(default='api', max_length=100)


class TutorIngestAcceptedResponse(BaseModel):
    model_config = camel_model_config

    job_id: str
    status: str
    dataset_version: str
    message: str


class TutorKnowledgeFileCreateRequest(BaseModel):
    model_config = camel_model_config

    file_id: str
    user_id: str
    filename: str
    description: str | None = None
    url: str
    key_r2: str
    mime_type: str
    size: int
    folder_id: str | None = None
    folder_name: str | None = None
    folder_description: str | None = None
    course_code: str | None = None
    language: str | None = None
    topic: str | None = None
    difficulty: Literal['basic', 'intermediate', 'advanced'] | None = None


class TutorKnowledgeFolderRequest(BaseModel):
    model_config = camel_model_config

    folder_id: str
    user_id: str
    name: str
    description: str | None = None
    icon: str


class TutorKnowledgeBulkRequest(BaseModel):
    model_config = camel_model_config

    file_ids: list[str]


class TutorKnowledgeFileResponse(BaseModel):
    model_config = camel_model_config

    file_id: str
    status: str
    progress: int
    chunk_count: int
    vector_count: int
    error_message: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    url: str


class TutorDatasetImportRequest(BaseModel):
    model_config = camel_model_config

    user_id: str
    folder_id: str | None = None
    dataset_key: str


class TutorDatasetImportResponse(BaseModel):
    model_config = camel_model_config

    job_id: str
    dataset_key: str
    status: str
    progress: int
    stage: str
    message: str | None = None


class StudentProgrammingSessionRequest(BaseModel):
    model_config = camel_model_config

    user_id: str
    title: str | None = None


class StudentProgrammingMessageRequest(BaseModel):
    model_config = camel_model_config

    user_id: str
    content: str
    role: str
    sources: list[dict[str, Any]] | None = None
    confidence: float | None = None
    model_used: str | None = None


class StudentProgrammingEvaluateRequest(BaseModel):
    model_config = camel_model_config

    user_id: str | None = None
    session_id: str | None = None
    message_id: str | None = None
    question: str
    answer: str
    model_type: str | None = None
    language: str | None = None


class TutorMessage(BaseModel):
    role: str
    content: str


class TutorQueryRequest(BaseModel):
    model_config = camel_model_config

    query: str
    history: list[TutorMessage] = Field(default_factory=list)
    course_code: str | None = None
    language: str | None = None
    topic: str | None = None
    difficulty: Literal['basic', 'intermediate', 'advanced'] | None = None
    top_k: int = Field(default=5, ge=1, le=10)
    model_type: str | None = 'qwen3_8b'
    fast_mode: bool = False


class TutorQueryResponse(BaseModel):
    model_config = camel_model_config

    answer: str
    sources: list[dict[str, Any]]
    model_used: str
    confidence: float
    retrieval_count: int


def _build_tutor_system_prompt() -> str:
    return (
        'Bạn là GenAI Tutor hỗ trợ sinh viên học lập trình C++ và Python. '
        'Hãy ưu tiên giải thích theo hướng sư phạm, nêu từng bước, và bám sát ngữ cảnh đã truy xuất. '
        'Nếu thông tin trong ngữ cảnh chưa đủ chắc chắn, hãy nói rõ giới hạn đó.'
    )


def _truncate_context_content(content: str, limit: int) -> str:
    normalized = content.strip()
    if len(normalized) <= limit:
        return normalized
    return normalized[:limit].rsplit(' ', 1)[0] + ' ...'


def _is_fast_mode_candidate(query: str) -> bool:
    normalized = query.strip().lower()
    if len(normalized) <= 180:
        return True

    fast_keywords = (
        'loi',
        'error',
        'bug',
        'fix',
        'debug',
        'segmentation fault',
        'indexerror',
        'syntaxerror',
        'typeerror',
        'vi sao',
        'tai sao',
    )
    return any(keyword in normalized for keyword in fast_keywords)


def _build_tutor_cache_key(request: TutorQueryRequest) -> str:
    history = '|'.join(
        f'{message.role}:{message.content.strip()[:120]}'
        for message in request.history[-3:]
    )
    return '::'.join(
        [
            request.query.strip().lower(),
            request.course_code or '',
            request.language or '',
            request.topic or '',
            request.difficulty or '',
            str(request.top_k),
            '1' if request.fast_mode else '0',
            history,
        ]
    )


def _prune_tutor_context_cache() -> None:
    now = time.monotonic()
    expired_keys = [
        key for key, (expires_at, _) in _tutor_context_cache.items() if expires_at <= now
    ]
    for key in expired_keys:
        _tutor_context_cache.pop(key, None)

    overflow = len(_tutor_context_cache) - _TUTOR_CONTEXT_CACHE_MAX_SIZE
    if overflow > 0:
        oldest_keys = list(_tutor_context_cache.keys())[:overflow]
        for key in oldest_keys:
            _tutor_context_cache.pop(key, None)


async def _retrieve_tutor_context(
    request: TutorQueryRequest,
) -> tuple[str, list[dict[str, Any]], float]:
    cache_key = _build_tutor_cache_key(request)
    _prune_tutor_context_cache()
    cached = _tutor_context_cache.get(cache_key)
    now = time.monotonic()
    if cached and cached[0] > now:
        return cached[1]

    query_embedding = await get_pg_vector_store().create_embedding(
        request.query,
        task_type='retrieval_query',
    )
    effective_top_k = 2 if request.fast_mode else request.top_k
    retrieved = await tutor_storage_service.search_chunks_hybrid(
        query_embedding=query_embedding,
        course_code=request.course_code,
        language=request.language,
        topic=request.topic,
        difficulty=request.difficulty,
        top_k=effective_top_k,
        query_text=request.query,
    )

    if not retrieved:
        raise HTTPException(status_code=404, detail='No tutor knowledge found for the given filters')

    chunk_ids = [item.chunk_id for item in retrieved]
    graph_facts: list[Any] = []
    neighbor_facts: list[Any] = []
    if not request.fast_mode:
        graph_facts, neighbor_facts = await asyncio.gather(
            tutor_storage_service.get_graph_facts(
                chunk_ids=chunk_ids,
                limit=6,
            ),
            tutor_storage_service.get_graph_neighbors(
                chunk_ids=chunk_ids,
                limit=6,
            ),
        )
    sources = [
        {
            'chunkId': item.chunk_id,
            'documentId': item.document_id,
            'datasetVersion': item.dataset_version,
            'sourcePath': item.source_path,
            'title': item.title,
            'chunkIndex': item.chunk_index,
            'similarityScore': item.similarity_score,
            'language': item.language,
            'topic': item.topic,
            'difficulty': item.difficulty,
        }
        for item in retrieved
    ]

    graph_context = ''
    combined_graph_facts = graph_facts + neighbor_facts
    if combined_graph_facts:
        graph_lines = []
        for fact in combined_graph_facts:
            if fact.relation_type and fact.related_entity_name:
                graph_lines.append(
                    f'- {fact.entity_name} ({fact.entity_type}) {fact.relation_type} {fact.related_entity_name} [w={fact.weight:.2f}]'
                )
            else:
                graph_lines.append(f'- {fact.entity_name} ({fact.entity_type})')
        graph_context = 'Graph facts and neighbors:\n' + '\n'.join(graph_lines)

    snippet_limit = 500 if request.fast_mode else 900
    text_context = '\n\n'.join(
        f"[Source: {item.title} | {item.source_path} | score={item.similarity_score:.3f}]\n{_truncate_context_content(item.content, snippet_limit)}"
        for item in retrieved
    )
    pre_context = text_context if not graph_context else f'{text_context}\n\n{graph_context}'
    confidence = max(0.0, min(1.0, max(item.similarity_score for item in retrieved)))
    result = (pre_context, sources, confidence)
    _tutor_context_cache[cache_key] = (now + _TUTOR_CONTEXT_CACHE_TTL_SECONDS, result)
    return result


@router.post('/ingest', response_model=TutorIngestAcceptedResponse)
async def create_tutor_ingest_job(request: TutorIngestRequest) -> TutorIngestAcceptedResponse:
    try:
        if '..' in request.source_path:
            raise HTTPException(status_code=400, detail='sourcePath không hợp lệ')

        job = await tutor_ingestion_pipeline.create_job(
            source_path=request.source_path,
            triggered_by=request.triggered_by,
            course_code=request.course_code,
            language=request.language,
            topic=request.topic,
            difficulty=request.difficulty,
            reindex_mode=request.reindex_mode,
            license_tag=request.license_tag,
            dry_run=request.dry_run,
        )
        return TutorIngestAcceptedResponse(
            job_id=job.job_id,
            status=job.status,
            dataset_version=job.dataset_version,
            message='Tutor ingestion job created successfully',
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.error('Failed to create tutor ingest job: %s', exc)
        raise HTTPException(status_code=500, detail='Failed to create tutor ingest job') from exc


@router.post('/knowledge-files', response_model=TutorKnowledgeFileResponse)
async def create_tutor_knowledge_file(
    request: TutorKnowledgeFileCreateRequest,
) -> TutorKnowledgeFileResponse:
    try:
        payload = {
            'fileId': request.file_id,
            'userId': request.user_id,
            'filename': request.filename,
            'description': request.description,
            'url': request.url,
            'keyR2': request.key_r2,
            'mimeType': request.mime_type,
            'size': request.size,
            'status': 'PENDING',
            'progress': 0,
            'folderId': request.folder_id,
            'folderName': request.folder_name,
            'folderDescription': request.folder_description,
            'courseCode': request.course_code,
            'language': request.language,
            'topic': request.topic,
            'difficulty': request.difficulty,
            'sourceType': Path(request.filename).suffix.lower().lstrip('.'),
            'chunkCount': 0,
            'vectorCount': 0,
            'embeddingModel': None,
            'errorMessage': None,
            'metadata': {},
            'createdAt': datetime.now(timezone.utc).isoformat(),
            'updatedAt': datetime.now(timezone.utc).isoformat(),
            'completedAt': None,
        }
        await tutor_knowledge_storage_service.create_file(payload)
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
                    'type': 'tutor.knowledge.requested',
                    'timestamp': int(datetime.now(timezone.utc).timestamp() * 1000),
                    'payload': payload,
                    'metadata': {'sourceService': 'ai-service'},
                }
                await exchange.publish(
                    aio_pika.Message(body=json.dumps(event).encode()),
                    routing_key='ai.tutor.knowledge.requested',
                )
        else:
            tutor_knowledge_file_worker.enqueue(payload)
        return TutorKnowledgeFileResponse(
            file_id=request.file_id,
            status='PENDING',
            progress=0,
            chunk_count=0,
            vector_count=0,
            error_message=None,
            metadata={
                'stage': 'queued',
                'graphStage': 'queued',
                'sourceType': Path(request.filename).suffix.lower().lstrip('.'),
            },
            url=request.url,
        )
    except Exception as exc:
        logger.error('Failed to create tutor knowledge file job: %s', exc)
        raise HTTPException(status_code=500, detail='Failed to create tutor knowledge file job') from exc


@router.get('/dataset-imports/catalog', response_model=list[dict[str, Any]])
async def list_tutor_dataset_catalog() -> list[dict[str, Any]]:
    return tutor_dataset_import_service.list_catalog()


@router.post('/dataset-imports', response_model=TutorDatasetImportResponse)
async def create_tutor_dataset_import(
    request: TutorDatasetImportRequest,
) -> TutorDatasetImportResponse:
    try:
        job = await tutor_dataset_import_service.create_job(
            user_id=request.user_id,
            folder_id=request.folder_id,
            dataset_key=request.dataset_key,
        )
        return TutorDatasetImportResponse(
            job_id=job['jobId'],
            dataset_key=job['datasetKey'],
            status=job['status'],
            progress=job['progress'],
            stage=job['stage'],
            message=job.get('message'),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.error('Failed to create dataset import job: %s', exc)
        raise HTTPException(status_code=500, detail='Failed to create dataset import job') from exc


@router.get('/dataset-imports', response_model=list[dict[str, Any]])
async def list_tutor_dataset_import_jobs(user_id: str) -> list[dict[str, Any]]:
    return await tutor_dataset_import_service.list_jobs(user_id)


@router.get('/dataset-imports/states', response_model=list[dict[str, Any]])
async def list_tutor_dataset_import_states(user_id: str) -> list[dict[str, Any]]:
    return await tutor_dataset_import_service.list_dataset_states(user_id)


@router.get('/student-programming/sessions', response_model=list[dict[str, Any]])
async def list_student_programming_sessions(user_id: str) -> list[dict[str, Any]]:
    return await student_programming_chat_service.list_sessions(user_id)


@router.post('/student-programming/sessions', response_model=dict[str, Any])
async def create_student_programming_session(request: StudentProgrammingSessionRequest) -> dict[str, Any]:
    return await student_programming_chat_service.create_session(
        {
            'id': f'student_chat_{uuid4().hex[:12]}',
            'userId': request.user_id,
            'title': request.title,
        }
    )


@router.patch('/student-programming/sessions/{session_id}', response_model=dict[str, Any])
async def update_student_programming_session(
    session_id: str,
    request: StudentProgrammingSessionRequest,
) -> dict[str, Any]:
    return await student_programming_chat_service.update_session(session_id, request.user_id, request.title or '')


@router.delete('/student-programming/sessions/{session_id}', response_model=dict[str, Any])
async def delete_student_programming_session(session_id: str, user_id: str) -> dict[str, Any]:
    return await student_programming_chat_service.delete_session(session_id, user_id)


@router.get('/student-programming/sessions/{session_id}/messages', response_model=list[dict[str, Any]])
async def list_student_programming_messages(session_id: str, user_id: str) -> list[dict[str, Any]]:
    return await student_programming_chat_service.list_messages(session_id, user_id)


@router.post('/student-programming/sessions/{session_id}/messages', response_model=dict[str, Any])
async def create_student_programming_message(
    session_id: str,
    request: StudentProgrammingMessageRequest,
) -> dict[str, Any]:
    return await student_programming_chat_service.create_message(
        {
            'id': f'student_msg_{uuid4().hex[:12]}',
            'sessionId': session_id,
            'userId': request.user_id,
            'role': request.role,
            'content': request.content,
            'metadata': {
                'sources': request.sources,
                'confidence': request.confidence,
                'modelUsed': request.model_used,
            },
        }
    )


@router.post('/student-programming/evaluate', response_model=dict[str, Any])
async def evaluate_student_programming_answer(
    request: StudentProgrammingEvaluateRequest,
) -> dict[str, Any]:
    try:
        if not request.user_id or not request.session_id or not request.message_id:
            raise HTTPException(status_code=400, detail='userId, sessionId và messageId là bắt buộc')

        return await student_programming_evaluation_service.create_job(
            user_id=request.user_id,
            session_id=request.session_id,
            message_id=request.message_id,
            question=request.question,
            answer=request.answer,
            model_type=request.model_type,
            language=request.language,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.error('Student programming evaluation failed: %s', exc)
        raise HTTPException(status_code=500, detail='Student programming evaluation failed') from exc


@router.get('/student-programming/evaluate/{job_id}', response_model=dict[str, Any])
async def get_student_programming_evaluation_job(
    job_id: str,
    user_id: str,
) -> dict[str, Any]:
    job = await student_programming_evaluation_service.get_job(job_id, user_id)
    if job is None:
        raise HTTPException(status_code=404, detail='Student programming evaluation job not found')
    return job


@router.get('/dataset-imports/{job_id}', response_model=dict[str, Any])
async def get_tutor_dataset_import_job(job_id: str) -> dict[str, Any]:
    job = await tutor_dataset_import_service.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail='Tutor dataset import job not found')
    return job


@router.post('/dataset-imports/{job_id}/cancel', response_model=dict[str, Any])
async def cancel_tutor_dataset_import_job(job_id: str) -> dict[str, Any]:
    try:
        return await tutor_dataset_import_service.cancel_job(job_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post('/dataset-imports/{dataset_key}/clear', response_model=dict[str, Any])
async def clear_tutor_dataset_import(
    dataset_key: str,
    user_id: str,
) -> dict[str, Any]:
    try:
        return await tutor_dataset_import_service.clear_dataset(
            user_id=user_id,
            dataset_key=dataset_key,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post('/knowledge-folders', response_model=dict[str, Any])
async def create_tutor_knowledge_folder(
    request: TutorKnowledgeFolderRequest,
) -> dict[str, Any]:
    payload = {
        'folderId': request.folder_id,
        'userId': request.user_id,
        'name': request.name,
        'description': request.description,
        'icon': request.icon,
        'metadata': {},
        'createdAt': datetime.now(timezone.utc).isoformat(),
        'updatedAt': datetime.now(timezone.utc).isoformat(),
    }
    return await tutor_knowledge_storage_service.create_folder(payload)


@router.put('/knowledge-folders/{folder_id}', response_model=dict[str, Any])
async def update_tutor_knowledge_folder(
    folder_id: str,
    request: TutorKnowledgeFolderRequest,
) -> dict[str, Any]:
    payload = {
        'folderId': folder_id,
        'name': request.name,
        'description': request.description,
        'icon': request.icon,
        'metadata': {},
        'updatedAt': datetime.now(timezone.utc).isoformat(),
    }
    return await tutor_knowledge_storage_service.update_folder(payload)


@router.delete('/knowledge-folders/{folder_id}', response_model=dict[str, Any])
async def delete_tutor_knowledge_folder(folder_id: str) -> dict[str, Any]:
    deleted_files = await tutor_knowledge_storage_service.delete_folder(folder_id)
    logger.info(
        'Audit: deleted knowledge folder %s with %s files',
        folder_id,
        len(deleted_files),
    )
    return {'success': True, 'deletedFiles': deleted_files}


@router.get('/knowledge-folders', response_model=list[dict[str, Any]])
async def list_tutor_knowledge_folders(user_id: str) -> list[dict[str, Any]]:
    return await tutor_knowledge_storage_service.list_folders(user_id)


@router.get('/knowledge-stats', response_model=dict[str, Any])
async def get_tutor_knowledge_stats(
    user_id: str,
    folder_id: str | None = None,
) -> dict[str, Any]:
    return await tutor_knowledge_storage_service.get_stats(
        user_id,
        folder_id=folder_id,
    )


@router.get('/knowledge-folders/{folder_id}/contents', response_model=dict[str, Any])
async def get_tutor_knowledge_folder_contents(
    folder_id: str,
    user_id: str,
    page: int = 1,
    page_size: int = 12,
) -> dict[str, Any]:
    folder = await tutor_knowledge_storage_service.get_folder(folder_id)
    if folder is None:
        raise HTTPException(status_code=404, detail='Tutor knowledge folder not found')
    files = await tutor_knowledge_storage_service.list_files(
        user_id,
        folder_id=folder_id,
        page=page,
        page_size=page_size,
    )
    return {'folder': folder, 'files': files}


@router.get('/knowledge-files/{file_id}', response_model=dict[str, Any])
async def get_tutor_knowledge_file(file_id: str) -> dict[str, Any]:
    record = await tutor_knowledge_storage_service.get_file(file_id)
    if record is None:
        raise HTTPException(status_code=404, detail='Tutor knowledge file not found')
    return record


@router.get('/knowledge-files/{file_id}/graph', response_model=dict[str, Any])
async def get_tutor_knowledge_file_graph(file_id: str) -> dict[str, Any]:
    record = await tutor_knowledge_storage_service.get_file(file_id)
    if record is None:
        raise HTTPException(status_code=404, detail='Tutor knowledge file not found')

    graph_document_id = record.get('graphDocumentId') or record['fileId']
    snapshot = await tutor_storage_service.get_graph_snapshot_by_document(graph_document_id)
    if not snapshot:
        raise HTTPException(status_code=404, detail='Tutor graph snapshot not found for knowledge file')
    return snapshot


@router.get('/knowledge-files', response_model=dict[str, Any])
async def list_tutor_knowledge_files(
    user_id: str,
    folder_id: str | None = None,
    status: str | None = None,
    search: str | None = None,
    sort_by: str = 'createdAt',
    sort_order: str = 'desc',
    page: int = 1,
    page_size: int = 12,
) -> dict[str, Any]:
    return await tutor_knowledge_storage_service.list_files(
        user_id,
        folder_id=folder_id,
        status=status,
        search=search,
        sort_by=sort_by,
        sort_order=sort_order,
        page=page,
        page_size=page_size,
    )


@router.delete('/knowledge-files/{file_id}', response_model=dict[str, Any])
async def delete_tutor_knowledge_file(file_id: str) -> dict[str, Any]:
    deleted = await tutor_knowledge_storage_service.delete_file(file_id)
    if deleted is None:
        raise HTTPException(status_code=404, detail='Tutor knowledge file not found')
    logger.info('Audit: deleted knowledge file %s', file_id)
    return deleted


@router.post('/knowledge-files/{file_id}/reprocess', response_model=dict[str, Any])
async def reprocess_tutor_knowledge_file(file_id: str) -> dict[str, Any]:
    record = await tutor_knowledge_storage_service.get_file(file_id)
    if record is None:
        raise HTTPException(status_code=404, detail='Tutor knowledge file not found')

    payload = {
        'fileId': record['fileId'],
        'userId': record['userId'],
        'filename': record['filename'],
        'description': record.get('description'),
        'url': record['url'],
        'keyR2': record['keyR2'],
        'mimeType': record['mimeType'],
        'size': record['size'],
        'status': 'PENDING',
        'progress': 0,
        'folderId': record.get('folderId'),
        'folderName': record.get('folderName'),
        'folderDescription': record.get('folderDescription'),
        'courseCode': record.get('courseCode'),
        'language': record.get('language'),
        'topic': record.get('topic'),
        'difficulty': record.get('difficulty'),
        'sourceType': record.get('sourceType'),
        'chunkCount': 0,
        'vectorCount': 0,
        'embeddingModel': None,
        'errorMessage': None,
        'metadata': {'stage': 'queued', 'message': 'Đang chờ xử lý lại'},
        'updatedAt': datetime.now(timezone.utc).isoformat(),
        'completedAt': None,
    }
    await tutor_knowledge_storage_service.update_file(payload)
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
                'type': 'tutor.knowledge.requested',
                'timestamp': int(datetime.now(timezone.utc).timestamp() * 1000),
                'payload': payload,
                'metadata': {'sourceService': 'ai-service', 'mode': 'reprocess'},
            }
            await exchange.publish(
                aio_pika.Message(body=json.dumps(event).encode()),
                routing_key='ai.tutor.knowledge.requested',
            )
    else:
        tutor_knowledge_file_worker.enqueue(payload)
    logger.info('Audit: reprocess requested for knowledge file %s', file_id)
    return {'success': True, 'fileId': file_id, 'status': 'PENDING'}


@router.post('/knowledge-files/bulk-delete', response_model=dict[str, Any])
async def bulk_delete_tutor_knowledge_files(request: TutorKnowledgeBulkRequest) -> dict[str, Any]:
    deleted_files: list[dict[str, Any]] = []
    for file_id in request.file_ids:
        deleted = await tutor_knowledge_storage_service.delete_file(file_id)
        if deleted is not None:
            deleted_files.append(deleted)
    logger.info('Audit: bulk deleted %s knowledge files', len(deleted_files))
    return {'success': True, 'deletedFiles': deleted_files}


@router.post('/knowledge-files/bulk-reprocess', response_model=dict[str, Any])
async def bulk_reprocess_tutor_knowledge_files(request: TutorKnowledgeBulkRequest) -> dict[str, Any]:
    queued_ids: list[str] = []
    for file_id in request.file_ids:
        result = await reprocess_tutor_knowledge_file(file_id)
        if result.get('success'):
            queued_ids.append(file_id)
    logger.info('Audit: bulk reprocess requested for %s knowledge files', len(queued_ids))
    return {'success': True, 'queuedFileIds': queued_ids}


@router.get('/ingest/{job_id}', response_model=dict[str, Any])
async def get_tutor_ingest_job(job_id: str) -> dict[str, Any]:
    job = await tutor_ingestion_pipeline.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail='Tutor ingest job not found')
    return job.to_dict()


@router.get('/ingest', response_model=list[dict[str, Any]])
async def list_tutor_ingest_jobs() -> list[dict[str, Any]]:
    jobs = await tutor_ingestion_pipeline.list_jobs()
    return [job.to_dict() for job in jobs[:20]]


@router.get('/graph/job/{job_id}', response_model=dict[str, Any])
async def get_tutor_graph_by_job(job_id: str) -> dict[str, Any]:
    snapshot = await tutor_storage_service.get_graph_snapshot_by_job(job_id)
    if not snapshot.get('documents'):
        raise HTTPException(status_code=404, detail='Tutor graph snapshot not found for job')
    return snapshot


@router.get('/graph/document/{document_id}', response_model=dict[str, Any])
async def get_tutor_graph_by_document(document_id: str) -> dict[str, Any]:
    snapshot = await tutor_storage_service.get_graph_snapshot_by_document(document_id)
    if not snapshot:
        raise HTTPException(status_code=404, detail='Tutor graph snapshot not found for document')
    return snapshot


@router.post('/query', response_model=TutorQueryResponse)
async def query_tutor(request: TutorQueryRequest) -> TutorQueryResponse:
    try:
        if len(request.query.strip()) < 3:
            raise HTTPException(status_code=400, detail='Query quá ngắn')

        request.fast_mode = request.fast_mode or _is_fast_mode_candidate(request.query)

        model_type = model_manager.resolve_model(request.model_type).id
        pre_context, sources, confidence = await _retrieve_tutor_context(request)
        agent = SimpleChatAgent(
            pre_context=pre_context,
            model_type=model_type,
            system_prompt=_build_tutor_system_prompt(),
        )

        full_query = request.query
        if request.history:
            history_text = '\n'.join(
                f'{message.role}: {message.content}'
                for message in request.history[-3:]
            )
            full_query = f'Conversation history:\n{history_text}\n\nUser: {request.query}'

        answer = agent.chat(full_query)

        return TutorQueryResponse(
            answer=answer,
            sources=sources,
            model_used=model_type,
            confidence=confidence,
            retrieval_count=len(sources),
        )
    except ModelUnavailableError as exc:
        raise HTTPException(status_code=503, detail={'code': exc.code, 'message': str(exc)}) from exc
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.error('Tutor query failed: %s', exc)
        raise HTTPException(status_code=500, detail='Tutor query failed') from exc


@router.post('/stream')
async def stream_tutor(request: TutorQueryRequest):
    try:
        if len(request.query.strip()) < 3:
            raise HTTPException(status_code=400, detail='Query quá ngắn')

        request.fast_mode = request.fast_mode or _is_fast_mode_candidate(request.query)

        model_type = model_manager.resolve_model(request.model_type).id
        pre_context, sources, confidence = await _retrieve_tutor_context(request)
        agent = SimpleChatAgent(
            pre_context=pre_context,
            model_type=model_type,
            system_prompt=_build_tutor_system_prompt(),
        )

        history_dicts = [
            {'role': message.role, 'content': message.content}
            for message in request.history
        ]

        def iter_response():
            full_answer = ''
            try:
                for chunk in agent.chat_stream(request.query, history=history_dicts):
                    chunk_text = str(chunk)
                    full_answer += chunk_text
                    yield f"data: {json.dumps({'type': 'chunk', 'data': chunk_text})}\n\n"

                done_payload = {
                    'type': 'done',
                    'data': {
                        'assistantMessage': {
                            'role': 'assistant',
                            'content': full_answer,
                        },
                        'sources': sources,
                        'confidence': confidence,
                        'modelUsed': model_type,
                        'retrievalCount': len(sources),
                    },
                }
                yield f'data: {json.dumps(done_payload)}\n\n'
            except Exception as exc:
                yield f"data: {json.dumps({'type': 'error', 'data': str(exc)})}\n\n"

        return StreamingResponse(iter_response(), media_type='text/event-stream')
    except ModelUnavailableError as exc:
        raise HTTPException(status_code=503, detail={'code': exc.code, 'message': str(exc)}) from exc
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.error('Tutor stream failed: %s', exc)
        raise HTTPException(status_code=500, detail='Tutor stream failed') from exc


@router.get('/health', response_model=dict[str, Any])
async def tutor_health_check() -> dict[str, Any]:
    return await tutor_ingestion_pipeline.get_health()
