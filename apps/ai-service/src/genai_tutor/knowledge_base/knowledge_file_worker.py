"""Background worker for tutor knowledge files."""

from __future__ import annotations

import asyncio
import hashlib
import io
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from urllib.request import urlopen
from uuid import uuid4

from src.backend.services.pdf_ocr_service import pdf_ocr_service
from src.backend.services.tutor_storage_service import tutor_storage_service
from src.backend.services.tutor_knowledge_storage_service import (
    tutor_knowledge_storage_service,
)
from src.genai_tutor.knowledge_base.graph_extractor import extract_knowledge_graph
from src.genai_tutor.knowledge_base.json_dataset_parser import (
    normalize_json_dataset,
)
from src.llm.model_manager import model_manager
from src.rag.vector_store_pg import get_pg_vector_store

logger = logging.getLogger(__name__)

TEXT_FILE_EXTENSIONS = {'.txt', '.md', '.markdown'}
CODE_FILE_EXTENSIONS = {'.py', '.c', '.h', '.cc', '.cpp', '.cxx', '.hpp'}
IMAGE_FILE_EXTENSIONS = {'.png', '.jpg', '.jpeg'}
DEFAULT_TEXT_CHUNK_SIZE = 1200
DEFAULT_CODE_CHUNK_SIZE = 1800
DEFAULT_JSON_CHUNK_SIZE = 1500


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _sha256_bytes(payload: bytes) -> str:
    return f'sha256:{hashlib.sha256(payload).hexdigest()}'


def _split_text_chunks(content: str, max_chars: int) -> list[str]:
    normalized = content.replace('\r\n', '\n').strip()
    if not normalized:
        return []

    paragraphs = [paragraph.strip() for paragraph in normalized.split('\n\n') if paragraph.strip()]
    chunks: list[str] = []
    current = ''

    for paragraph in paragraphs:
        candidate = paragraph if not current else f'{current}\n\n{paragraph}'
        if len(candidate) <= max_chars:
            current = candidate
            continue

        if current:
            chunks.append(current)
            current = ''

        if len(paragraph) <= max_chars:
            current = paragraph
            continue

        remaining = paragraph
        while remaining:
            chunks.append(remaining[:max_chars])
            remaining = remaining[max_chars:]

    if current:
        chunks.append(current)

    return chunks


def _split_code_chunks(content: str, max_chars: int) -> list[str]:
    normalized = content.replace('\r\n', '\n').strip()
    if not normalized:
        return []

    lines = normalized.splitlines()
    chunks: list[str] = []
    current_lines: list[str] = []
    current_size = 0

    for line in lines:
        is_boundary = (
            line.startswith('def ')
            or line.startswith('class ')
            or line.startswith('int ')
            or line.startswith('void ')
            or line.startswith('char ')
            or line.startswith('float ')
            or line.startswith('double ')
            or line.startswith('#include')
        )
        line_size = len(line) + 1
        if current_lines and (is_boundary and current_size >= max_chars * 0.5 or current_size + line_size > max_chars):
            chunks.append('\n'.join(current_lines).strip())
            current_lines = []
            current_size = 0

        current_lines.append(line)
        current_size += line_size

    if current_lines:
        chunks.append('\n'.join(current_lines).strip())

    return [chunk for chunk in chunks if chunk]


class TutorKnowledgeFileWorker:
    def __init__(self) -> None:
        self._tasks: dict[str, asyncio.Task[Any]] = {}

    def enqueue(self, file_payload: dict[str, Any]) -> None:
        file_id = file_payload['fileId']
        self._tasks[file_id] = asyncio.create_task(self._process(file_payload))

    async def _process(self, file_payload: dict[str, Any]) -> None:
        file_id = file_payload['fileId']
        try:
            await tutor_knowledge_storage_service.update_file(
                {
                    **file_payload,
                    'status': 'PROCESSING',
                    'progress': 10,
                    'updatedAt': _utc_now().isoformat(),
                    'metadata': {'stage': 'downloading'},
                }
            )

            file_bytes = await asyncio.to_thread(self._download_file, file_payload['url'])
            await tutor_knowledge_storage_service.update_file(
                {
                    **file_payload,
                    'status': 'PROCESSING',
                    'progress': 35,
                    'updatedAt': _utc_now().isoformat(),
                    'metadata': {'stage': 'extracting'},
                }
            )

            extracted_text, content_type = await self._extract_content(
                file_bytes=file_bytes,
                filename=file_payload['filename'],
                mime_type=file_payload['mimeType'],
            )
            if not extracted_text.strip():
                raise RuntimeError('No text extracted from file')

            await tutor_knowledge_storage_service.update_file(
                {
                    **file_payload,
                    'status': 'PROCESSING',
                    'progress': 50,
                    'updatedAt': _utc_now().isoformat(),
                    'metadata': {
                        'stage': 'chunking',
                        'sourceType': Path(file_payload['filename']).suffix.lower().lstrip('.'),
                    },
                }
            )

            chunks = self._build_chunks(
                file_id=file_id,
                extracted_text=extracted_text,
                content_type=content_type,
                source_type=file_payload.get('sourceType'),
            )
            await tutor_knowledge_storage_service.update_file(
                {
                    **file_payload,
                    'status': 'PROCESSING',
                    'progress': 60,
                    'chunkCount': len(chunks),
                    'updatedAt': _utc_now().isoformat(),
                    'metadata': {
                        'stage': 'embedding',
                        'graphStage': 'pending',
                        'sourceType': file_payload.get('sourceType'),
                    },
                }
            )

            embedding_model = model_manager.get_embedding_info()['id']
            embeddings = await get_pg_vector_store().create_embeddings_batch(
                [chunk['content'] for chunk in chunks],
                task_type='retrieval_document',
            ) if chunks else []

            await tutor_knowledge_storage_service.replace_vectors(
                file_id=file_id,
                embedding_model=embedding_model,
                vectors=chunks,
                embeddings=embeddings,
            )

            graph_document_id = await self._upsert_graph_document(
                file_payload=file_payload,
                file_bytes=file_bytes,
                extracted_text=extracted_text,
                content_type=content_type,
                chunks=chunks,
                embeddings=embeddings,
                embedding_model=embedding_model,
            )

            await tutor_knowledge_storage_service.update_file(
                {
                    **file_payload,
                    'status': 'PROCESSING',
                    'progress': 85,
                    'chunkCount': len(chunks),
                    'vectorCount': len(chunks),
                    'embeddingModel': embedding_model,
                    'graphDocumentId': graph_document_id,
                    'updatedAt': _utc_now().isoformat(),
                    'metadata': {
                        'stage': 'graphing',
                        'graphStage': 'building',
                        'sourceType': file_payload.get('sourceType'),
                        'contentType': content_type,
                    },
                }
            )

            await tutor_knowledge_storage_service.update_file(
                {
                    **file_payload,
                    'status': 'COMPLETED',
                    'progress': 100,
                    'chunkCount': len(chunks),
                    'vectorCount': len(chunks),
                    'embeddingModel': embedding_model,
                    'graphDocumentId': graph_document_id,
                    'updatedAt': _utc_now().isoformat(),
                    'completedAt': _utc_now().isoformat(),
                    'metadata': {
                        'stage': 'completed',
                        'graphStage': 'completed',
                        'sourceType': file_payload.get('sourceType'),
                        'contentType': content_type,
                    },
                }
            )
        except Exception as exc:
            logger.exception('Tutor knowledge file processing failed: %s', file_id)
            await tutor_knowledge_storage_service.update_file(
                {
                    **file_payload,
                    'status': 'FAILED',
                    'progress': 100,
                    'errorMessage': str(exc),
                    'updatedAt': _utc_now().isoformat(),
                    'completedAt': _utc_now().isoformat(),
                    'metadata': {
                        'stage': 'failed',
                        'graphStage': 'failed',
                        'sourceType': file_payload.get('sourceType'),
                    },
                }
            )

    def _download_file(self, url: str) -> bytes:
        with urlopen(url) as response:  # noqa: S310
            return response.read()

    async def _extract_content(
        self,
        *,
        file_bytes: bytes,
        filename: str,
        mime_type: str,
    ) -> tuple[str, str]:
        suffix = Path(filename).suffix.lower()
        if suffix in TEXT_FILE_EXTENSIONS | CODE_FILE_EXTENSIONS:
            return file_bytes.decode('utf-8', errors='ignore'), 'code' if suffix in CODE_FILE_EXTENSIONS else 'text'

        if suffix == '.docx' or mime_type == 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
            try:
                from docx import Document as DocxDocument
            except ImportError as exc:
                raise RuntimeError('python-docx dependency is not available') from exc

            document = DocxDocument(io.BytesIO(file_bytes))
            paragraphs = [paragraph.text.strip() for paragraph in document.paragraphs if paragraph.text.strip()]
            return '\n\n'.join(paragraphs), 'text'

        if suffix == '.pdf' or mime_type == 'application/pdf':
            extracted = await asyncio.to_thread(pdf_ocr_service.extract_text_from_pdf, file_bytes)
            return extracted, 'text'

        if suffix == '.json' or mime_type in {'application/json', 'text/json'}:
            text = file_bytes.decode('utf-8', errors='ignore')
            try:
                normalized, _dataset_type = normalize_json_dataset(text)
            except ValueError as exc:
                raise RuntimeError(str(exc)) from exc
            return normalized, 'json'

        if suffix in IMAGE_FILE_EXTENSIONS or mime_type.startswith('image/'):
            try:
                import pytesseract
                from PIL import Image
            except ImportError as exc:
                raise RuntimeError('Image OCR dependencies are not available') from exc

            def run_ocr() -> str:
                image = Image.open(io.BytesIO(file_bytes))
                return pytesseract.image_to_string(image, lang='eng+vie')

            extracted = await asyncio.to_thread(run_ocr)
            return extracted, 'text'

        return file_bytes.decode('utf-8', errors='ignore'), 'text'

    def _build_chunks(
        self,
        *,
        file_id: str,
        extracted_text: str,
        content_type: str,
        source_type: str | None = None,
    ) -> list[dict[str, Any]]:
        if content_type == 'code':
            chunk_contents = _split_code_chunks(extracted_text, DEFAULT_CODE_CHUNK_SIZE)
        elif content_type == 'json' or source_type == 'json':
            chunk_contents = _split_text_chunks(extracted_text, DEFAULT_JSON_CHUNK_SIZE)
        else:
            chunk_contents = _split_text_chunks(extracted_text, DEFAULT_TEXT_CHUNK_SIZE)

        return [
            {
                'id': f'tkv_{uuid4().hex[:12]}',
                'chunkIndex': index,
                'content': content,
                'contentType': content_type,
                'checksum': _sha256_bytes(content.encode('utf-8', errors='ignore')),
                'tokenCount': max(1, len(content.split())),
                'metadata': {
                    'fileId': file_id,
                    'contentType': content_type,
                    'sourceType': source_type,
                },
            }
            for index, content in enumerate(chunk_contents)
        ]

    async def _upsert_graph_document(
        self,
        *,
        file_payload: dict[str, Any],
        file_bytes: bytes,
        extracted_text: str,
        content_type: str,
        chunks: list[dict[str, Any]],
        embeddings: list[list[float]],
        embedding_model: str,
    ) -> str:
        document_id = file_payload.get('graphDocumentId') or file_payload['fileId']
        dataset_version = f"knowledge-file:{file_payload['userId']}"
        job_id = f"knowledge-file:{file_payload['fileId']}"
        source_type = file_payload.get('sourceType') or Path(file_payload['filename']).suffix.lower().lstrip('.')
        language = (file_payload.get('language') or content_type or 'text').lower()

        await tutor_storage_service.create_job(
            {
                'jobId': job_id,
                'datasetVersion': dataset_version,
                'status': 'completed',
                'sourcePath': file_payload['filename'],
                'triggeredBy': 'knowledge-file-upload',
                'courseCode': file_payload.get('courseCode') or 'KNOWLEDGE_BASE',
                'language': language,
                'topic': file_payload.get('topic'),
                'difficulty': file_payload.get('difficulty'),
                'reindexMode': 'incremental',
                'licenseTag': None,
                'dryRun': False,
                'summary': {
                    'chunkCount': len(chunks),
                    'vectorCount': len(chunks),
                    'sourceType': source_type,
                },
                'warnings': [],
                'errors': [],
                'createdAt': _utc_now().isoformat(),
                'startedAt': _utc_now().isoformat(),
                'finishedAt': _utc_now().isoformat(),
            }
        )

        await tutor_storage_service.upsert_document(
            {
                'document_id': document_id,
                'source_path': file_payload['filename'],
                'source_type': source_type,
                'checksum': _sha256_bytes(file_bytes),
                'title': file_payload['filename'],
                'language': language,
                'course_code': file_payload.get('courseCode') or 'KNOWLEDGE_BASE',
                'topic': file_payload.get('topic'),
                'difficulty': file_payload.get('difficulty'),
                'license_tag': None,
                'status': 'completed',
                'chunk_count': len(chunks),
                'error': None,
            },
            job_id,
            dataset_version,
        )

        graph_chunks = [
            {
                'chunk_id': chunk['id'],
                'content': chunk['content'],
                'content_type': chunk['contentType'],
                'language': language,
                'topic': file_payload.get('topic'),
                'difficulty': file_payload.get('difficulty'),
                'token_count': chunk['tokenCount'],
                'checksum': chunk['checksum'],
                'chunk_index': chunk['chunkIndex'],
                'start_offset': extracted_text.find(chunk['content']),
                'end_offset': extracted_text.find(chunk['content']) + len(chunk['content']),
            }
            for chunk in chunks
        ]

        await tutor_storage_service.replace_document_chunks(
            job_id=job_id,
            dataset_version=dataset_version,
            document_id=document_id,
            embedding_model=embedding_model,
            chunks=graph_chunks,
            embeddings=embeddings,
        )

        await tutor_storage_service.update_job(
            {
                'jobId': job_id,
                'datasetVersion': dataset_version,
                'status': 'completed',
                'sourcePath': file_payload['filename'],
                'triggeredBy': 'knowledge-file-upload',
                'courseCode': file_payload.get('courseCode') or 'KNOWLEDGE_BASE',
                'language': language,
                'topic': file_payload.get('topic'),
                'difficulty': file_payload.get('difficulty'),
                'reindexMode': 'incremental',
                'licenseTag': None,
                'dryRun': False,
                'summary': {
                    'chunkCount': len(chunks),
                    'vectorCount': len(chunks),
                    'sourceType': source_type,
                },
                'warnings': [],
                'errors': [],
                'startedAt': _utc_now().isoformat(),
                'finishedAt': _utc_now().isoformat(),
            }
        )

        for chunk in chunks:
            graph = extract_knowledge_graph(
                content=chunk['content'],
                content_type=chunk['contentType'],
                language=file_payload.get('language') or content_type,
                metadata={
                    'sourceType': source_type,
                    'filename': file_payload['filename'],
                },
            )
            entities = [
                {
                    'entityId': f"tge_{uuid4().hex[:12]}",
                    'entityType': entity.entity_type,
                    'name': entity.name,
                    'canonicalName': entity.canonical_name,
                    'language': entity.language,
                    'properties': entity.properties,
                }
                for entity in graph.entities
            ]
            relations = [
                {
                    'relationId': f"tgr_{uuid4().hex[:12]}",
                    'relationType': relation.relation_type,
                    'fromCanonicalName': relation.from_name,
                    'toCanonicalName': relation.to_name,
                    'weight': relation.weight,
                }
                for relation in graph.relations
            ]
            await tutor_storage_service.replace_chunk_graph(
                dataset_version=dataset_version,
                document_id=document_id,
                chunk_id=chunk['id'],
                entities=entities,
                relations=relations,
            )

        return document_id


tutor_knowledge_file_worker = TutorKnowledgeFileWorker()
