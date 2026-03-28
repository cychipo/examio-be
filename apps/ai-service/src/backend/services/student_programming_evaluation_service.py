from __future__ import annotations

import asyncio
import difflib
import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

import aio_pika
import asyncpg

from src.backend.services.student_programming_chat_service import (
    student_programming_chat_service,
)
from src.evaluation.datasets.loaders.humaneval_loader import load_humaneval_samples
from src.evaluation.datasets.loaders.mbpp_loader import load_mbpp_samples
from src.evaluation.datasets.schemas import EvaluationSample
from src.evaluation.pipeline.code_extractor import extract_code_block
from src.evaluation.sandbox.executor import ExecutionSandbox
from src.evaluation.sandbox.models import SandboxExecutionRequest


EVALUATION_ROUTING_KEY = 'ai.tutor.student-evaluation.requested'
EXCHANGE_NAME = 'examio.events'
logger = logging.getLogger(__name__)


class StudentProgrammingEvaluationService:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self) -> None:
        self.sandbox = ExecutionSandbox()
        self._sample_cache: list[EvaluationSample] | None = None
        self._pool: asyncpg.Pool | None = None

    def infer_language(
        self,
        question: str,
        answer: str,
        explicit_language: str | None = None,
    ) -> Literal['python', 'c']:
        if explicit_language == 'python':
            return 'python'
        if explicit_language == 'c':
            return 'c'

        combined = f'{question}\n{answer}'.lower()
        if '```c' in combined or '#include' in combined or re.search(r'\bprintf\s*\(', combined):
            return 'c'
        return 'python'

    def _load_samples(self) -> list[EvaluationSample]:
        if self._sample_cache is not None:
            return self._sample_cache

        samples: list[EvaluationSample] = []
        humaneval_path = Path('src/evaluation/datasets/samples/humaneval_smoke.jsonl')
        mbpp_path = Path('src/evaluation/datasets/samples/mbpp_smoke.json')
        if humaneval_path.exists():
            samples.extend(load_humaneval_samples(humaneval_path))
        if mbpp_path.exists():
            samples.extend(load_mbpp_samples(mbpp_path))
        self._sample_cache = samples
        return samples

    async def _get_pool(self) -> asyncpg.Pool:
        if self._pool is None or self._pool._closed:
            postgres_uri = os.environ.get('DATABASE_URL')
            if not postgres_uri:
                raise ValueError('DATABASE_URL environment variable not set')
            self._pool = await asyncpg.create_pool(
                postgres_uri,
                min_size=1,
                max_size=4,
                command_timeout=30,
            )
        return self._pool

    def _build_imported_sample(self, row: asyncpg.Record, language: Literal['python', 'c']) -> EvaluationSample | None:
        metadata = row['metadata'] or {}
        source_path = row['sourcePath']
        content = row['content'] or ''
        title = row['title'] or Path(source_path).name

        if not any(keyword in source_path.lower() for keyword in ('humaneval', 'mbpp')):
            return None

        if not any(token in source_path.lower() for token in ('test', 'prompt', 'solution')):
            return None

        prompt = metadata.get('prompt') or title
        test_code = metadata.get('test_code') or metadata.get('test') or content
        if not test_code or len(test_code.strip()) < 8:
            return None

        dataset_name = 'humaneval' if 'humaneval' in source_path.lower() else 'mbpp'
        return EvaluationSample(
            sample_id=row['id'],
            dataset_name=dataset_name,
            language=language,
            prompt=prompt,
            reference_solution=metadata.get('canonical_solution') or metadata.get('reference_solution'),
            test_code=test_code,
            entry_point=metadata.get('entry_point'),
            metadata={
                'source': 'imported-benchmark',
                'sourcePath': source_path,
            },
        )

    async def _load_imported_samples(self, language: Literal['python', 'c']) -> list[EvaluationSample]:
        pool = await self._get_pool()
        query = '''
            SELECT chunk.id, chunk.content, chunk.metadata, doc.title, doc."sourcePath"
            FROM "TutorKnowledgeChunk" chunk
            INNER JOIN "TutorKnowledgeDocument" doc ON doc.id = chunk."documentId"
            WHERE chunk.language = $1
              AND (
                doc."sourcePath" ILIKE '%humaneval%'
                OR doc."sourcePath" ILIKE '%mbpp%'
              )
            ORDER BY doc."updatedAt" DESC, chunk."chunkIndex" ASC
            LIMIT 200
        '''
        async with pool.acquire() as conn:
            rows = await conn.fetch(query, language)

        samples: list[EvaluationSample] = []
        for row in rows:
            sample = self._build_imported_sample(row, language)
            if sample is not None:
                samples.append(sample)
        logger.info('[student-eval] loaded %s imported benchmark candidates for %s', len(samples), language)
        return samples

    def _normalize_text(self, value: str) -> set[str]:
        tokens = re.findall(r'[a-zA-Z_]{3,}', value.lower())
        return set(tokens)

    def _normalize_string(self, value: str) -> str:
        return ' '.join(re.findall(r'[a-zA-Z_0-9]+', value.lower()))

    def _score_sample_match(
        self,
        question: str,
        sample: EvaluationSample,
    ) -> float:
        question_tokens = self._normalize_text(question)
        prompt_tokens = self._normalize_text(sample.prompt)
        overlap = len(question_tokens & prompt_tokens)
        coverage = overlap / max(len(prompt_tokens), 1)

        normalized_question = self._normalize_string(question)
        normalized_prompt = self._normalize_string(sample.prompt)
        ratio = difflib.SequenceMatcher(None, normalized_question, normalized_prompt).ratio()

        entry_bonus = 0.0
        if sample.entry_point and sample.entry_point.lower() in normalized_question:
            entry_bonus = 0.25

        dataset_bonus = 0.1 if sample.dataset_name in {'humaneval', 'mbpp'} else 0.0
        return overlap + coverage + ratio + entry_bonus + dataset_bonus

    async def _find_matching_sample(
        self,
        question: str,
        language: Literal['python', 'c'],
    ) -> EvaluationSample | None:
        best_sample: EvaluationSample | None = None
        best_score = 0.0

        imported_samples = await self._load_imported_samples(language)
        candidate_samples = imported_samples or self._load_samples()

        for sample in candidate_samples:
            if sample.language != language:
                continue
            score = self._score_sample_match(question, sample)
            if score > best_score:
                best_score = score
                best_sample = sample

        logger.info('[student-eval] best deterministic sample score=%.3f sample=%s', best_score, best_sample.sample_id if best_sample else None)
        if best_score < 1.6:
            return None
        return best_sample

    def _is_testable_python_code(self, code: str) -> bool:
        stripped = code.strip()
        if not stripped or 'input(' in stripped:
            return False
        return bool(re.search(r'(^|\n)(def|class)\s+\w+', stripped))

    def _is_testable_c_code(self, code: str) -> bool:
        stripped = code.strip()
        if not stripped or 'scanf(' in stripped or 'gets(' in stripped:
            return False
        return bool(re.search(r'\b[a-zA-Z_][\w\s\*]+\s+[a-zA-Z_][\w]*\s*\([^\)]*\)\s*\{', stripped))

    async def create_job(
        self,
        *,
        user_id: str,
        session_id: str,
        message_id: str,
        question: str,
        answer: str,
        model_type: str | None = None,
        language: str | None = None,
    ) -> dict[str, Any]:
        job = await student_programming_chat_service.create_evaluation_job(
            {
                'id': f'student_eval_{uuid4().hex[:12]}',
                'userId': user_id,
                'sessionId': session_id,
                'messageId': message_id,
                'status': 'queued',
                'metadata': {
                    'question': question,
                    'answer': answer,
                    'modelType': model_type,
                    'language': language,
                },
            }
        )
        logger.info('[student-eval] created deterministic job %s', job['id'])
        await self._publish_job(job['id'])
        return job

    async def get_job(self, job_id: str, user_id: str) -> dict[str, Any] | None:
        return await student_programming_chat_service.get_evaluation_job(job_id, user_id)

    async def _publish_job(self, job_id: str) -> None:
        rabbitmq_url = os.getenv('RABBITMQ_URL', 'amqp://localhost:5672')
        connection = await aio_pika.connect_robust(rabbitmq_url)
        async with connection:
            channel = await connection.channel()
            exchange = await channel.declare_exchange(
                EXCHANGE_NAME,
                aio_pika.ExchangeType.TOPIC,
                durable=True,
            )
            payload = {
                'type': 'tutor.student-evaluation.requested',
                'payload': {
                    'jobId': job_id,
                },
            }
            await exchange.publish(
                aio_pika.Message(
                    body=json.dumps(payload).encode('utf-8'),
                    content_type='application/json',
                    delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
                ),
                routing_key=EVALUATION_ROUTING_KEY,
            )

    async def run_job(self, job_id: str) -> None:
        job = await student_programming_chat_service.get_evaluation_job(job_id, '%')
        if job is None:
            logger.warning('Student evaluation job %s not found', job_id)
            return
        await self._run_job(job_id, job['userId'])

    async def _run_job(self, job_id: str, user_id: str) -> None:
        started_at = time.perf_counter()
        await student_programming_chat_service.update_evaluation_job(
            job_id,
            user_id,
            {
                'status': 'running',
                'metadata': {'stage': 'matching-dataset'},
            },
        )
        job = await student_programming_chat_service.get_evaluation_job(job_id, user_id)
        if job is None:
            return

        metadata = job.get('metadata') or {}
        question = metadata.get('question', '')
        answer = metadata.get('answer', '')
        language = self.infer_language(question, answer, metadata.get('language'))

        try:
            result = await asyncio.to_thread(self._evaluate_answer_sync, question, answer, language)
            updated_job = await student_programming_chat_service.update_evaluation_job(
                job_id,
                user_id,
                {
                    **result,
                    'status': 'completed',
                    'completedAt': True,
                    'metadata': {
                        'stage': 'completed',
                    },
                },
            )
            await student_programming_chat_service.attach_evaluation_to_message(
                session_id=job['sessionId'],
                message_id=job['messageId'],
                user_id=user_id,
                evaluation=result,
                evaluation_job=updated_job,
            )
            logger.info('[student-eval] deterministic job %s finished in %.2fms', job_id, (time.perf_counter() - started_at) * 1000)
        except Exception as exc:
            logger.exception('[student-eval] deterministic job %s failed: %s', job_id, exc)
            await student_programming_chat_service.update_evaluation_job(
                job_id,
                user_id,
                {
                    'status': 'failed',
                    'errorMessage': str(exc),
                    'rationale': 'Không thể hoàn tất đánh giá tự động.',
                    'metadata': {'stage': 'failed'},
                    'completedAt': True,
                },
            )

    def _evaluate_answer_sync(
        self,
        question: str,
        answer: str,
        language: Literal['python', 'c'],
    ) -> dict[str, Any]:
        extracted_code = extract_code_block(answer, language)
        logger.info('[student-eval] deterministic extracted code preview=%s', extracted_code[:200].replace('\n', '\\n'))

        if language == 'python' and not self._is_testable_python_code(extracted_code):
            return {
                'score': 0,
                'status': 'unavailable',
                'language': language,
                'rationale': 'Chưa có dữ liệu để đánh giá tự động cho câu trả lời dạng script/snippet này.',
                'passed': 0,
                'total': 0,
                'executionTimeMs': 0,
                'stderr': '',
                'stdout': '',
                'testCode': '',
                'modelUsed': None,
            }

        if language == 'c' and not self._is_testable_c_code(extracted_code):
            return {
                'score': 0,
                'status': 'unavailable',
                'language': language,
                'rationale': 'Chưa có dữ liệu để đánh giá tự động cho câu trả lời C này.',
                'passed': 0,
                'total': 0,
                'executionTimeMs': 0,
                'stderr': '',
                'stdout': '',
                'testCode': '',
                'modelUsed': None,
            }

        sample = asyncio.run(self._find_matching_sample(question, language))
        if sample is None:
            return {
                'score': 0,
                'status': 'unavailable',
                'language': language,
                'rationale': 'Chưa có dữ liệu benchmark phù hợp để đánh giá tự động cho câu hỏi này.',
                'passed': 0,
                'total': 0,
                'executionTimeMs': 0,
                'stderr': '',
                'stdout': '',
                'testCode': '',
                'modelUsed': None,
            }

        logger.info('[student-eval] matched benchmark sample %s from %s', sample.sample_id, sample.dataset_name)
        result = self.sandbox.execute(
            SandboxExecutionRequest(
                language=language,
                source_code=extracted_code,
                test_code=sample.test_code,
                entry_point=sample.entry_point,
                sample_id=f'student_eval_{sample.sample_id}',
            )
        )

        passed = 1 if result.status == 'passed' else 0
        total = 1
        score = 100 if passed else 0
        response = {
            'score': score,
            'status': result.status,
            'language': language,
            'rationale': f'Đã đối chiếu với benchmark {sample.dataset_name}:{sample.sample_id}.',
            'passed': passed,
            'total': total,
            'executionTimeMs': result.execution_time_ms,
            'stderr': result.stderr,
            'stdout': result.stdout,
            'testCode': sample.test_code,
            'modelUsed': None,
        }
        self.sandbox.cleanup(result)
        return response


student_programming_evaluation_service = StudentProgrammingEvaluationService()
