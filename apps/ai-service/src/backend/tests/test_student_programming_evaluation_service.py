from __future__ import annotations

import asyncio

import src.backend.services.student_programming_evaluation_service as eval_module
from src.backend.services.student_programming_evaluation_service import (
    student_programming_evaluation_service,
)


def test_create_job_publishes_rabbitmq_event() -> None:
    original_create = eval_module.student_programming_chat_service.create_evaluation_job
    original_publish = student_programming_evaluation_service._publish_job

    published: list[str] = []

    async def fake_create(payload):
        return {
            'id': payload['id'],
            'userId': payload['userId'],
            'sessionId': payload['sessionId'],
            'messageId': payload['messageId'],
            'status': 'queued',
            'metadata': payload['metadata'],
        }

    async def fake_publish(job_id: str):
        published.append(job_id)

    eval_module.student_programming_chat_service.create_evaluation_job = fake_create  # type: ignore[method-assign]
    student_programming_evaluation_service._publish_job = fake_publish  # type: ignore[method-assign]

    async def scenario() -> None:
        job = await student_programming_evaluation_service.create_job(
            user_id='student_1',
            session_id='session_1',
            message_id='message_1',
            question='Write add(a, b)',
            answer='def add(a, b): return a + b',
            model_type='qwen3_8b',
            language='python',
        )
        assert job['status'] == 'queued'

    try:
        asyncio.run(scenario())
        assert len(published) == 1
        assert published[0].startswith('student_eval_')
    finally:
        eval_module.student_programming_chat_service.create_evaluation_job = original_create  # type: ignore[method-assign]
        student_programming_evaluation_service._publish_job = original_publish  # type: ignore[method-assign]


def test_run_job_attaches_completed_evaluation_to_message() -> None:
    original_get = eval_module.student_programming_chat_service.get_evaluation_job
    original_update = eval_module.student_programming_chat_service.update_evaluation_job
    original_attach = eval_module.student_programming_chat_service.attach_evaluation_to_message
    original_eval = student_programming_evaluation_service._evaluate_answer_sync

    updates: list[dict] = []
    attachments: list[dict] = []

    async def fake_get(job_id: str, user_id: str):
        return {
            'id': job_id,
            'userId': 'student_1',
            'sessionId': 'session_1',
            'messageId': 'message_1',
            'status': 'queued',
            'metadata': {
                'question': 'Write add(a, b)',
                'answer': 'def add(a, b): return a + b',
                'modelType': 'qwen3_8b',
                'language': 'python',
            },
        }

    async def fake_update(job_id: str, user_id: str, payload: dict):
        updates.append(payload)
        return {
            'id': job_id,
            'userId': 'student_1',
            'sessionId': 'session_1',
            'messageId': 'message_1',
            'status': payload.get('status', 'running'),
            'score': payload.get('score'),
        }

    async def fake_attach(**payload):
        attachments.append(payload)
        return payload

    def fake_eval(question: str, answer: str, language: str):
        return {
            'score': 100,
            'status': 'passed',
            'language': 'python',
            'rationale': 'Matched deterministic benchmark sample.',
            'passed': 1,
            'total': 1,
            'executionTimeMs': 20.0,
            'stderr': '',
            'stdout': '',
            'testCode': 'assert add(1, 2) == 3',
            'modelUsed': None,
        }

    eval_module.student_programming_chat_service.get_evaluation_job = fake_get  # type: ignore[method-assign]
    eval_module.student_programming_chat_service.update_evaluation_job = fake_update  # type: ignore[method-assign]
    eval_module.student_programming_chat_service.attach_evaluation_to_message = fake_attach  # type: ignore[method-assign]
    student_programming_evaluation_service._evaluate_answer_sync = fake_eval  # type: ignore[method-assign]

    async def scenario() -> None:
        await student_programming_evaluation_service.run_job('student_eval_123')

    try:
        asyncio.run(scenario())
        assert updates[0]['status'] == 'running'
        assert updates[-1]['status'] == 'completed'
        assert attachments
        assert attachments[0]['evaluation']['score'] == 100
    finally:
        eval_module.student_programming_chat_service.get_evaluation_job = original_get  # type: ignore[method-assign]
        eval_module.student_programming_chat_service.update_evaluation_job = original_update  # type: ignore[method-assign]
        eval_module.student_programming_chat_service.attach_evaluation_to_message = original_attach  # type: ignore[method-assign]
        student_programming_evaluation_service._evaluate_answer_sync = original_eval  # type: ignore[method-assign]
