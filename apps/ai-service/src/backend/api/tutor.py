"""Tutor-specific API endpoints."""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal, Optional

import aio_pika
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from src.llm.model_manager import ModelUnavailableError, model_manager
from src.backend.services.tutor_knowledge_storage_service import (
    tutor_knowledge_storage_service,
)
from src.backend.services.tutor_dataset_import_service import (
    tutor_dataset_import_service,
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


class TutorIngestRequest(BaseModel):
    source_path: str = Field(..., alias='sourcePath', description='Folder or file path under allowed data-source root')
    course_code: str = Field(..., alias='courseCode', min_length=2, max_length=50)
    language: Optional[str] = Field(default=None, description='Target language such as c or python')
    topic: Optional[str] = Field(default=None, max_length=100)
    difficulty: Optional[Literal['basic', 'intermediate', 'advanced']] = None
    reindex_mode: Literal['incremental', 'full', 'graph-only', 'embedding-only'] = Field(
        default='incremental',
        alias='reindexMode',
    )
    license_tag: Optional[str] = Field(default=None, alias='licenseTag', max_length=100)
    dry_run: bool = Field(default=False, alias='dryRun')
    triggered_by: str = Field(default='api', alias='triggeredBy', max_length=100)


class TutorIngestAcceptedResponse(BaseModel):
    job_id: str = Field(..., alias='jobId')
    status: str
    dataset_version: str = Field(..., alias='datasetVersion')
    message: str


class TutorKnowledgeFileCreateRequest(BaseModel):
    file_id: str = Field(..., alias='fileId')
    user_id: str = Field(..., alias='userId')
    filename: str
    description: Optional[str] = None
    url: str
    key_r2: str = Field(..., alias='keyR2')
    mime_type: str = Field(..., alias='mimeType')
    size: int
    folder_id: Optional[str] = Field(default=None, alias='folderId')
    folder_name: Optional[str] = Field(default=None, alias='folderName')
    folder_description: Optional[str] = Field(default=None, alias='folderDescription')
    course_code: Optional[str] = Field(default=None, alias='courseCode')
    language: Optional[str] = None
    topic: Optional[str] = None
    difficulty: Optional[Literal['basic', 'intermediate', 'advanced']] = None


class TutorKnowledgeFolderRequest(BaseModel):
    folder_id: str = Field(..., alias='folderId')
    user_id: str = Field(..., alias='userId')
    name: str
    description: Optional[str] = None
    icon: str


class TutorKnowledgeBulkRequest(BaseModel):
    file_ids: list[str] = Field(..., alias='fileIds')


class TutorKnowledgeFileResponse(BaseModel):
    file_id: str = Field(..., alias='fileId')
    status: str
    progress: int
    chunk_count: int = Field(..., alias='chunkCount')
    vector_count: int = Field(..., alias='vectorCount')
    error_message: Optional[str] = Field(default=None, alias='errorMessage')
    metadata: dict[str, Any] = Field(default_factory=dict)
    url: str


class TutorDatasetImportRequest(BaseModel):
    user_id: str = Field(..., alias='userId')
    folder_id: Optional[str] = Field(default=None, alias='folderId')
    dataset_key: str = Field(..., alias='datasetKey')


class TutorDatasetImportResponse(BaseModel):
    job_id: str = Field(..., alias='jobId')
    dataset_key: str = Field(..., alias='datasetKey')
    status: str
    progress: int
    stage: str
    message: Optional[str] = None


class TutorMessage(BaseModel):
    role: str
    content: str


class TutorQueryRequest(BaseModel):
    query: str
    history: list[TutorMessage] = Field(default_factory=list)
    course_code: str = Field(..., alias='courseCode')
    language: Optional[str] = None
    topic: Optional[str] = None
    difficulty: Optional[Literal['basic', 'intermediate', 'advanced']] = None
    top_k: int = Field(default=5, alias='topK', ge=1, le=10)
    model_type: Optional[str] = Field(default='qwen3_8b', alias='modelType')


class TutorQueryResponse(BaseModel):
    answer: str
    sources: list[dict[str, Any]]
    model_used: str = Field(..., alias='modelUsed')
    confidence: float
    retrieval_count: int = Field(..., alias='retrievalCount')


def _build_tutor_system_prompt() -> str:
    return (
        'Bạn là GenAI Tutor hỗ trợ sinh viên học lập trình C và Python. '
        'Hãy ưu tiên giải thích theo hướng sư phạm, nêu từng bước, và bám sát ngữ cảnh đã truy xuất. '
        'Nếu thông tin trong ngữ cảnh chưa đủ chắc chắn, hãy nói rõ giới hạn đó.'
    )


async def _retrieve_tutor_context(
    request: TutorQueryRequest,
) -> tuple[str, list[dict[str, Any]], float]:
    query_embedding = await get_pg_vector_store().create_embedding(
        request.query,
        task_type='retrieval_query',
    )
    retrieved = await tutor_storage_service.search_chunks_hybrid(
        query_embedding=query_embedding,
        course_code=request.course_code,
        language=request.language,
        topic=request.topic,
        difficulty=request.difficulty,
        top_k=request.top_k,
        query_text=request.query,
    )

    if not retrieved:
        raise HTTPException(status_code=404, detail='No tutor knowledge found for the given filters')

    graph_facts = await tutor_storage_service.get_graph_facts(
        chunk_ids=[item.chunk_id for item in retrieved],
        limit=10,
    )
    neighbor_facts = await tutor_storage_service.get_graph_neighbors(
        chunk_ids=[item.chunk_id for item in retrieved],
        limit=10,
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

    text_context = '\n\n'.join(
        f"[Source: {item.title} | {item.source_path} | score={item.similarity_score:.3f}]\n{item.content}"
        for item in retrieved
    )
    pre_context = text_context if not graph_context else f'{text_context}\n\n{graph_context}'
    confidence = max(0.0, min(1.0, max(item.similarity_score for item in retrieved)))
    return pre_context, sources, confidence


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
            jobId=job.job_id,
            status=job.status,
            datasetVersion=job.dataset_version,
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
            fileId=request.file_id,
            status='PENDING',
            progress=0,
            chunkCount=0,
            vectorCount=0,
            errorMessage=None,
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
            jobId=job['jobId'],
            datasetKey=job['datasetKey'],
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
    folder_id: Optional[str] = None,
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
    folder_id: Optional[str] = None,
    status: Optional[str] = None,
    search: Optional[str] = None,
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
                for message in request.history[-5:]
            )
            full_query = f'Conversation history:\n{history_text}\n\nUser: {request.query}'

        answer = agent.chat(full_query)

        return TutorQueryResponse(
            answer=answer,
            sources=sources,
            modelUsed=model_type,
            confidence=confidence,
            retrievalCount=len(sources),
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
