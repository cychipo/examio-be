"""Background worker for tutor knowledge files."""

from __future__ import annotations

import asyncio
import hashlib
import io
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from urllib.request import urlopen
from uuid import uuid4

from src.backend.services.pdf_ocr_service import pdf_ocr_service
from src.backend.services.tutor_knowledge_storage_service import (
    tutor_knowledge_storage_service,
)
from src.llm.model_manager import model_manager
from src.rag.vector_store_pg import get_pg_vector_store

logger = logging.getLogger(__name__)

TEXT_FILE_EXTENSIONS = {'.txt', '.md', '.markdown'}
CODE_FILE_EXTENSIONS = {'.py', '.c', '.h'}
IMAGE_FILE_EXTENSIONS = {'.png', '.jpg', '.jpeg'}
DEFAULT_TEXT_CHUNK_SIZE = 1200
DEFAULT_CODE_CHUNK_SIZE = 1800


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

            chunks = self._build_chunks(
                file_id=file_id,
                extracted_text=extracted_text,
                content_type=content_type,
            )
            await tutor_knowledge_storage_service.update_file(
                {
                    **file_payload,
                    'status': 'PROCESSING',
                    'progress': 60,
                    'chunkCount': len(chunks),
                    'updatedAt': _utc_now().isoformat(),
                    'metadata': {'stage': 'embedding'},
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
            await tutor_knowledge_storage_service.update_file(
                {
                    **file_payload,
                    'status': 'COMPLETED',
                    'progress': 100,
                    'chunkCount': len(chunks),
                    'vectorCount': len(chunks),
                    'embeddingModel': embedding_model,
                    'updatedAt': _utc_now().isoformat(),
                    'completedAt': _utc_now().isoformat(),
                    'metadata': {'stage': 'completed'},
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
                    'metadata': {'stage': 'failed'},
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
    ) -> list[dict[str, Any]]:
        if content_type == 'code':
            chunk_contents = _split_code_chunks(extracted_text, DEFAULT_CODE_CHUNK_SIZE)
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
                },
            }
            for index, content in enumerate(chunk_contents)
        ]


tutor_knowledge_file_worker = TutorKnowledgeFileWorker()
