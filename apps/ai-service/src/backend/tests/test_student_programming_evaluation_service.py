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
    original_context = student_programming_evaluation_service._get_benchmark_match_context
    original_find = student_programming_evaluation_service._find_matching_sample

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

    async def fake_context(question: str, language: str):
        return {
            'language': language,
            'candidateCount': 1,
            'signals': {
                'function_name': 'add',
                'task_id': None,
            },
            'hasImportedBenchmarks': True,
        }

    async def fake_find(question: str, language: str):
        from src.evaluation.datasets.schemas import EvaluationSample

        return EvaluationSample(
            sample_id='HumanEval/0',
            dataset_name='humaneval',
            language='python',
            prompt='Write add(a, b)',
            reference_solution='def add(a, b): return a + b',
            test_code='assert add(1, 2) == 3',
            entry_point='add',
            metadata={'source': 'HumanEval'},
        )

    def fake_eval(question: str, answer: str, language: str, benchmark_context: dict, sample):
        assert benchmark_context['candidateCount'] == 1
        assert sample is not None
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
    student_programming_evaluation_service._get_benchmark_match_context = fake_context  # type: ignore[method-assign]
    student_programming_evaluation_service._find_matching_sample = fake_find  # type: ignore[method-assign]
    student_programming_evaluation_service._evaluate_answer_sync = fake_eval  # type: ignore[method-assign]

    async def scenario() -> None:
        await student_programming_evaluation_service.run_job('student_eval_123')

    try:
        asyncio.run(scenario())
        assert updates[0]['status'] == 'running'
        assert updates[0]['language'] == 'python'
        assert updates[-1]['status'] == 'completed'
        assert attachments
        assert attachments[0]['evaluation']['score'] == 100
    finally:
        eval_module.student_programming_chat_service.get_evaluation_job = original_get  # type: ignore[method-assign]
        eval_module.student_programming_chat_service.update_evaluation_job = original_update  # type: ignore[method-assign]
        eval_module.student_programming_chat_service.attach_evaluation_to_message = original_attach  # type: ignore[method-assign]
        student_programming_evaluation_service._get_benchmark_match_context = original_context  # type: ignore[method-assign]
        student_programming_evaluation_service._find_matching_sample = original_find  # type: ignore[method-assign]
        student_programming_evaluation_service._evaluate_answer_sync = original_eval  # type: ignore[method-assign]


def test_run_job_failed_preserves_language_and_error_message() -> None:
    original_get = eval_module.student_programming_chat_service.get_evaluation_job
    original_update = eval_module.student_programming_chat_service.update_evaluation_job
    original_attach = eval_module.student_programming_chat_service.attach_evaluation_to_message
    original_eval = student_programming_evaluation_service._evaluate_answer_sync
    original_context = student_programming_evaluation_service._get_benchmark_match_context
    original_find = student_programming_evaluation_service._find_matching_sample

    updates: list[dict] = []

    async def fake_get(job_id: str, user_id: str):
        return {
            'id': job_id,
            'userId': 'student_1',
            'sessionId': 'session_1',
            'messageId': 'message_1',
            'status': 'queued',
            'metadata': {
                'question': 'Write a C++ function two_sum(nums, target).',
                'answer': '```cpp\n#include <vector>\nusing namespace std;\nvector<int> two_sum(vector<int>& nums, int target) { return {}; }\n```',
                'modelType': 'qwen3_8b',
                'language': None,
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
            'language': payload.get('language'),
            'errorMessage': payload.get('errorMessage'),
            'metadata': payload.get('metadata', {}),
        }

    async def fake_attach(**payload):
        raise AssertionError('attach_evaluation_to_message should not be called on failure')

    async def fake_context(question: str, language: str):
        return {
            'language': language,
            'candidateCount': 1,
            'signals': {
                'function_name': 'two_sum',
                'task_id': None,
            },
            'hasImportedBenchmarks': True,
        }

    async def fake_find(question: str, language: str):
        from src.evaluation.datasets.schemas import EvaluationSample

        return EvaluationSample(
            sample_id='cpp_1',
            dataset_name='multipl_e_humaneval_cpp',
            language='cpp',
            prompt='Write a C++ function two_sum(nums, target).',
            reference_solution=None,
            test_code='int main() { return 0; }',
            entry_point='two_sum',
            metadata={'source': 'MultiPL-E'},
        )

    def fake_eval(question: str, answer: str, language: str, benchmark_context: dict, sample):
        assert benchmark_context['candidateCount'] == 1
        assert sample is not None
        raise RuntimeError()

    eval_module.student_programming_chat_service.get_evaluation_job = fake_get  # type: ignore[method-assign]
    eval_module.student_programming_chat_service.update_evaluation_job = fake_update  # type: ignore[method-assign]
    eval_module.student_programming_chat_service.attach_evaluation_to_message = fake_attach  # type: ignore[method-assign]
    student_programming_evaluation_service._get_benchmark_match_context = fake_context  # type: ignore[method-assign]
    student_programming_evaluation_service._find_matching_sample = fake_find  # type: ignore[method-assign]
    student_programming_evaluation_service._evaluate_answer_sync = fake_eval  # type: ignore[method-assign]

    async def scenario() -> None:
        await student_programming_evaluation_service.run_job('student_eval_456')

    try:
        asyncio.run(scenario())
        assert updates[0]['status'] == 'running'
        assert updates[0]['language'] == 'cpp'
        assert updates[-1]['status'] == 'failed'
        assert updates[-1]['language'] == 'cpp'
        assert updates[-1]['errorMessage'] == 'RuntimeError: unknown evaluation failure'
        assert updates[-1]['rationale'] == 'Không thể hoàn tất đánh giá tự động.'
        assert updates[-1]['metadata']['stage'] == 'failed'
        assert updates[-1]['metadata']['errorMessage'] == 'RuntimeError: unknown evaluation failure'
    finally:
        eval_module.student_programming_chat_service.get_evaluation_job = original_get  # type: ignore[method-assign]
        eval_module.student_programming_chat_service.update_evaluation_job = original_update  # type: ignore[method-assign]
        eval_module.student_programming_chat_service.attach_evaluation_to_message = original_attach  # type: ignore[method-assign]
        student_programming_evaluation_service._get_benchmark_match_context = original_context  # type: ignore[method-assign]
        student_programming_evaluation_service._find_matching_sample = original_find  # type: ignore[method-assign]
        student_programming_evaluation_service._evaluate_answer_sync = original_eval  # type: ignore[method-assign]


def test_evaluate_answer_returns_benchmark_metadata() -> None:
    original_context = student_programming_evaluation_service._get_benchmark_match_context
    original_find = student_programming_evaluation_service._find_matching_sample
    original_execute = student_programming_evaluation_service.sandbox.execute
    original_cleanup = student_programming_evaluation_service.sandbox.cleanup

    async def fake_context(question: str, language: str):
        assert language == 'python'
        return {
            'language': language,
            'candidateCount': 1,
            'signals': {
                'function_name': 'add',
                'task_id': None,
            },
            'hasImportedBenchmarks': True,
        }

    async def fake_find(question: str, language: str):
        from src.evaluation.datasets.schemas import EvaluationSample

        return EvaluationSample(
            sample_id='HumanEval/0',
            dataset_name='humaneval',
            language='python',
            prompt='Write add(a, b)',
            reference_solution='def add(a, b): return a + b',
            test_code='assert add(1, 2) == 3',
            entry_point='add',
            metadata={'source': 'HumanEval'},
        )

    class FakeResult:
        status = 'passed'
        execution_time_ms = 12.5
        stderr = ''
        stdout = ''

    def fake_execute(_request):
        return FakeResult()

    def fake_cleanup(_result):
        return None

    student_programming_evaluation_service._get_benchmark_match_context = fake_context  # type: ignore[method-assign]
    student_programming_evaluation_service._find_matching_sample = fake_find  # type: ignore[method-assign]
    student_programming_evaluation_service.sandbox.execute = fake_execute  # type: ignore[method-assign]
    student_programming_evaluation_service.sandbox.cleanup = fake_cleanup  # type: ignore[method-assign]

    try:
        result = student_programming_evaluation_service._evaluate_answer_sync(
            'Write add(a, b)',
            '```python\ndef add(a, b):\n    return a + b\n```',
            'python',
            {
                'language': 'python',
                'candidateCount': 1,
                'signals': {
                    'function_name': 'add',
                    'task_id': None,
                },
                'hasImportedBenchmarks': True,
            },
            eval_module.EvaluationSample(
                sample_id='HumanEval/0',
                dataset_name='humaneval',
                language='python',
                prompt='Write add(a, b)',
                reference_solution='def add(a, b): return a + b',
                test_code='assert add(1, 2) == 3',
                entry_point='add',
                metadata={'source': 'HumanEval'},
            ),
        )
        assert result['score'] == 100
        assert result['benchmark'] == {
            'datasetName': 'humaneval',
            'sampleId': 'HumanEval/0',
            'entryPoint': 'add',
            'source': 'HumanEval',
        }
    finally:
        student_programming_evaluation_service._get_benchmark_match_context = original_context  # type: ignore[method-assign]
        student_programming_evaluation_service._find_matching_sample = original_find  # type: ignore[method-assign]
        student_programming_evaluation_service.sandbox.execute = original_execute  # type: ignore[method-assign]
        student_programming_evaluation_service.sandbox.cleanup = original_cleanup  # type: ignore[method-assign]


def test_find_matching_sample_prefers_entry_point_signal() -> None:
    original_list_items = eval_module.benchmark_index_service.list_items

    async def fake_list_items(language: str):
        assert language == 'python'
        return [
            {
                'id': 'mbpp_2',
                'datasetName': 'mbpp',
                'language': 'python',
                'prompt': 'Write a function to reverse a string.',
                'entryPoint': 'reverse_string',
                'testCode': "assert reverse_string('abc') == 'cba'",
                'referenceSolution': 'def reverse_string(value): return value[::-1]',
                'metadata': {
                    'source': 'MBPP',
                    'task_id': 2,
                    'entry_point': 'reverse_string',
                },
            },
            {
                'id': 'HumanEval/0',
                'datasetName': 'humaneval',
                'language': 'python',
                'prompt': 'Write a function add(a, b) that returns the sum of two integers.',
                'entryPoint': 'add',
                'testCode': 'assert add(1, 2) == 3',
                'referenceSolution': 'def add(a, b): return a + b',
                'metadata': {
                    'source': 'HumanEval',
                    'task_id': 'HumanEval/0',
                    'entry_point': 'add',
                },
            },
        ]

    eval_module.benchmark_index_service.list_items = fake_list_items  # type: ignore[method-assign]

    try:
        sample = asyncio.run(
            student_programming_evaluation_service._find_matching_sample(
                'Write a function reverse_string(value) that reverses a string.',
                'python',
            )
        )
        assert sample is not None
        assert sample.sample_id == 'mbpp_2'
    finally:
        eval_module.benchmark_index_service.list_items = original_list_items  # type: ignore[method-assign]


def test_find_matching_sample_accepts_stringified_metadata() -> None:
    original_list_items = eval_module.benchmark_index_service.list_items

    async def fake_list_items(language: str):
        assert language == 'cpp'
        return [
            {
                'id': 'cpp_1',
                'datasetName': 'multipl_e_humaneval_cpp',
                'language': 'cpp',
                'prompt': 'Write a C++ function has_close_elements(numbers, threshold).',
                'entryPoint': 'has_close_elements',
                'testCode': 'int main() { return 0; }',
                'referenceSolution': None,
                'metadata': '{"source": "MultiPL-E", "task_id": "HumanEval/0", "entry_point": "has_close_elements"}',
            },
        ]

    eval_module.benchmark_index_service.list_items = fake_list_items  # type: ignore[method-assign]

    try:
        sample = asyncio.run(
            student_programming_evaluation_service._find_matching_sample(
                'Write a C++ function has_close_elements(numbers, threshold).',
                'cpp',
            )
        )
        assert sample is not None
        assert sample.sample_id == 'cpp_1'
        assert sample.metadata['source'] == 'MultiPL-E'
        assert sample.entry_point == 'has_close_elements'
    finally:
        eval_module.benchmark_index_service.list_items = original_list_items  # type: ignore[method-assign]


def test_find_matching_sample_matches_vietnamese_prime_question() -> None:
    original_list_items = eval_module.benchmark_index_service.list_items

    async def fake_list_items(language: str):
        assert language == 'cpp'
        return [
            {
                'id': 'cpp_prime_1',
                'datasetName': 'multipl_e_humaneval_cpp',
                'language': 'cpp',
                'prompt': 'Write a C++ function is_prime(n) that returns true when n is a prime number.',
                'entryPoint': 'is_prime',
                'testCode': 'int main() { return is_prime(101) ? 0 : 1; }',
                'referenceSolution': None,
                'metadata': {
                    'source': 'MultiPL-E',
                    'task_id': 'HumanEval/prime',
                    'entry_point': 'is_prime',
                },
            },
            {
                'id': 'cpp_other_1',
                'datasetName': 'multipl_e_humaneval_cpp',
                'language': 'cpp',
                'prompt': 'Write a C++ function reverse_string(value).',
                'entryPoint': 'reverse_string',
                'testCode': 'int main() { return 0; }',
                'referenceSolution': None,
                'metadata': {
                    'source': 'MultiPL-E',
                    'task_id': 'HumanEval/reverse',
                    'entry_point': 'reverse_string',
                },
            },
        ]

    eval_module.benchmark_index_service.list_items = fake_list_items  # type: ignore[method-assign]

    try:
        sample = asyncio.run(
            student_programming_evaluation_service._find_matching_sample(
                'Hướng dẫn từng bước cách giải bài kiểm tra số nguyên tố bằng C++ mà chưa đưa full code ngay.',
                'cpp',
            )
        )
        assert sample is not None
        assert sample.sample_id == 'cpp_prime_1'
        assert sample.entry_point == 'is_prime'
    finally:
        eval_module.benchmark_index_service.list_items = original_list_items  # type: ignore[method-assign]


def test_evaluate_answer_uses_python_rule_based_fallback() -> None:
    original_execute = student_programming_evaluation_service.sandbox.execute
    original_cleanup = student_programming_evaluation_service.sandbox.cleanup

    class FakeResult:
        status = 'passed'
        execution_time_ms = 9.5
        stderr = ''
        stdout = ''

    def fake_execute(request):
        assert request.language == 'python'
        assert 'assert add(1, 2) == 3' in request.test_code
        assert request.entry_point == 'add'
        return FakeResult()

    def fake_cleanup(_result):
        return None

    student_programming_evaluation_service.sandbox.execute = fake_execute  # type: ignore[method-assign]
    student_programming_evaluation_service.sandbox.cleanup = fake_cleanup  # type: ignore[method-assign]

    try:
        result = student_programming_evaluation_service._evaluate_answer_sync(
            'Write a function add(a, b) that returns the sum of two integers.',
            '```python\ndef add(a, b):\n    return a + b\n```',
            'python',
            {
                'language': 'python',
                'candidateCount': 427,
                'signals': {
                    'function_name': 'add',
                    'task_id': None,
                },
                'hasImportedBenchmarks': True,
            },
            None,
        )
        assert result['status'] == 'passed'
        assert result['score'] == 100
        assert result['benchmark'] == {
            'datasetName': 'rule_based_fallback',
            'sampleId': 'fallback/python/add_two_numbers',
            'entryPoint': 'add',
            'source': 'rule_based_fallback',
            'ruleId': 'add_two_numbers',
            'phase': 1,
            'synthetic': True,
        }
        assert 'rule-based fallback phase 1' in result['rationale']
    finally:
        student_programming_evaluation_service.sandbox.execute = original_execute  # type: ignore[method-assign]
        student_programming_evaluation_service.sandbox.cleanup = original_cleanup  # type: ignore[method-assign]


def test_evaluate_answer_uses_cpp_rule_based_fallback() -> None:
    original_execute = student_programming_evaluation_service.sandbox.execute
    original_cleanup = student_programming_evaluation_service.sandbox.cleanup

    class FakeResult:
        status = 'passed'
        execution_time_ms = 11.0
        stderr = ''
        stdout = ''

    def fake_execute(request):
        assert request.language == 'cpp'
        assert 'assert(candidate(2) == true);' in request.test_code
        assert request.entry_point == 'is_prime'
        return FakeResult()

    def fake_cleanup(_result):
        return None

    student_programming_evaluation_service.sandbox.execute = fake_execute  # type: ignore[method-assign]
    student_programming_evaluation_service.sandbox.cleanup = fake_cleanup  # type: ignore[method-assign]

    try:
        result = student_programming_evaluation_service._evaluate_answer_sync(
            'Viết hàm C++ kiểm tra số nguyên tố tên is_prime(n).',
            '```cpp\nbool is_prime(int n) {\n    if (n < 2) return false;\n    for (int i = 2; i * i <= n; ++i) {\n        if (n % i == 0) return false;\n    }\n    return true;\n}\n```',
            'cpp',
            {
                'language': 'cpp',
                'candidateCount': 99,
                'signals': {
                    'function_name': 'is_prime',
                    'task_id': None,
                },
                'hasImportedBenchmarks': True,
            },
            None,
        )
        assert result['status'] == 'passed'
        assert result['score'] == 100
        assert result['benchmark']['datasetName'] == 'rule_based_fallback'
        assert result['benchmark']['ruleId'] == 'prime_check'
        assert result['benchmark']['entryPoint'] == 'is_prime'
        assert 'rule-based fallback phase 1' in result['rationale']
    finally:
        student_programming_evaluation_service.sandbox.execute = original_execute  # type: ignore[method-assign]
        student_programming_evaluation_service.sandbox.cleanup = original_cleanup  # type: ignore[method-assign]


def test_evaluate_answer_returns_clear_unavailable_rationale() -> None:
    original_context = student_programming_evaluation_service._get_benchmark_match_context
    original_find = student_programming_evaluation_service._find_matching_sample

    async def fake_context(question: str, language: str):
        assert language == 'python'
        return {
            'language': language,
            'candidateCount': 427,
            'signals': {
                'function_name': 'two_sum',
                'task_id': None,
            },
            'hasImportedBenchmarks': True,
        }

    async def fake_find(question: str, language: str):
        return None

    student_programming_evaluation_service._get_benchmark_match_context = fake_context  # type: ignore[method-assign]
    student_programming_evaluation_service._find_matching_sample = fake_find  # type: ignore[method-assign]

    try:
        result = student_programming_evaluation_service._evaluate_answer_sync(
            'Write a function two_sum(nums, target).',
            '```python\ndef two_sum(nums, target):\n    return []\n```',
            'python',
            {
                'language': 'python',
                'candidateCount': 427,
                'signals': {
                    'function_name': 'two_sum',
                    'task_id': None,
                },
                'hasImportedBenchmarks': True,
            },
            None,
        )
        assert result['status'] == 'unavailable'
        assert 'two_sum' in result['rationale']
        assert result['benchmark'] == {
            'candidateCount': 427,
            'signals': {
                'function_name': 'two_sum',
                'task_id': None,
            },
        }
    finally:
        student_programming_evaluation_service._get_benchmark_match_context = original_context  # type: ignore[method-assign]
        student_programming_evaluation_service._find_matching_sample = original_find  # type: ignore[method-assign]


def test_infer_language_detects_cpp() -> None:
    detected = student_programming_evaluation_service.infer_language(
        'Write a function twoSum in C++.',
        '```cpp\n#include <vector>\nusing namespace std;\nvector<int> twoSum(vector<int>& nums, int target) { return {}; }\n```',
    )
    assert detected == 'cpp'


def test_estimate_test_count_counts_asserts() -> None:
    python_count = student_programming_evaluation_service._estimate_test_count(
        'assert add(1, 2) == 3\nassert add(0, 0) == 0',
        'python',
    )
    cpp_count = student_programming_evaluation_service._estimate_test_count(
        'int main() {\n    assert(candidate(6) == false);\n    assert(candidate(101) == true);\n    return 0;\n}',
        'cpp',
    )

    assert python_count == 2
    assert cpp_count == 2


def test_evaluate_answer_extracts_cpp_fenced_code() -> None:
    original_context = student_programming_evaluation_service._get_benchmark_match_context
    original_find = student_programming_evaluation_service._find_matching_sample
    original_execute = student_programming_evaluation_service.sandbox.execute
    original_cleanup = student_programming_evaluation_service.sandbox.cleanup

    async def fake_context(question: str, language: str):
        return {
            'language': language,
            'candidateCount': 1,
            'signals': {
                'function_name': 'two_sum',
                'task_id': None,
            },
            'hasImportedBenchmarks': True,
        }

    async def fake_find(question: str, language: str):
        from src.evaluation.datasets.schemas import EvaluationSample

        return EvaluationSample(
            sample_id='cpp_1',
            dataset_name='humaneval',
            language='cpp',
            prompt='Write a C++ function two_sum(nums, target).',
            reference_solution=None,
            test_code='int main() { assert(candidate(1) == true); assert(candidate(2) == true); return 0; }',
            entry_point='two_sum',
            metadata={'source': 'MultiPL-E'},
        )

    captured_request = None

    class FakeResult:
        status = 'passed'
        execution_time_ms = 8.0
        stderr = ''
        stdout = ''

    def fake_execute(request):
        nonlocal captured_request
        captured_request = request
        return FakeResult()

    def fake_cleanup(_result):
        return None

    student_programming_evaluation_service._get_benchmark_match_context = fake_context  # type: ignore[method-assign]
    student_programming_evaluation_service._find_matching_sample = fake_find  # type: ignore[method-assign]
    student_programming_evaluation_service.sandbox.execute = fake_execute  # type: ignore[method-assign]
    student_programming_evaluation_service.sandbox.cleanup = fake_cleanup  # type: ignore[method-assign]

    try:
        result = student_programming_evaluation_service._evaluate_answer_sync(
            'Write a C++ function two_sum(nums, target).',
            '```cpp\n#include <vector>\nusing namespace std;\nvector<int> two_sum(vector<int>& nums, int target) { return {}; }\n```',
            'cpp',
            {
                'language': 'cpp',
                'candidateCount': 1,
                'signals': {
                    'function_name': 'two_sum',
                    'task_id': None,
                },
                'hasImportedBenchmarks': True,
            },
            eval_module.EvaluationSample(
                sample_id='cpp_1',
                dataset_name='humaneval',
                language='cpp',
                prompt='Write a C++ function two_sum(nums, target).',
                reference_solution=None,
                test_code='int main() { assert(candidate(1) == true); assert(candidate(2) == true); return 0; }',
                entry_point='two_sum',
                metadata={'source': 'MultiPL-E'},
            ),
        )
        assert result['status'] == 'passed'
        assert result['passed'] == 2
        assert result['total'] == 2
        assert result['score'] == 100
        assert captured_request is not None
        assert captured_request.language == 'cpp'
        assert 'vector<int> two_sum' in captured_request.source_code
        assert captured_request.source_code.startswith('#include <vector>')
    finally:
        student_programming_evaluation_service._get_benchmark_match_context = original_context  # type: ignore[method-assign]
        student_programming_evaluation_service._find_matching_sample = original_find  # type: ignore[method-assign]
        student_programming_evaluation_service.sandbox.execute = original_execute  # type: ignore[method-assign]
        student_programming_evaluation_service.sandbox.cleanup = original_cleanup  # type: ignore[method-assign]

