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

from src.backend.services.benchmark_index_service import benchmark_index_service
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


def _normalize_metadata(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


class StudentProgrammingEvaluationService:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self) -> None:
        self.sandbox = ExecutionSandbox()
        self._sample_cache: list[EvaluationSample] | None = None

    def infer_language(
        self,
        question: str,
        answer: str,
        explicit_language: str | None = None,
    ) -> Literal['python', 'c', 'cpp']:
        if explicit_language == 'python':
            return 'python'
        if explicit_language == 'c':
            return 'c'
        if explicit_language == 'cpp':
            return 'cpp'

        combined = f'{question}\n{answer}'.lower()
        if '```cpp' in combined or '```c++' in combined or 'std::' in combined or '#include <vector>' in combined:
            return 'cpp'
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

    def _expand_bilingual_terms(self, value: str) -> str:
        expanded = value.lower()
        replacements = {
            'số nguyên tố': 'prime primality is_prime',
            'nguyên tố': 'prime',
            'hàm': 'function',
            'kiểm tra': 'check test verify',
            'bài kiểm tra': 'task problem exercise',
            'từng bước': 'step by step',
        }
        for needle, replacement in replacements.items():
            expanded = expanded.replace(needle, f'{needle} {replacement}')
        return expanded

    def _normalize_text(self, value: str) -> set[str]:
        expanded = self._expand_bilingual_terms(value)
        tokens = re.findall(r'[a-zA-Z_]{3,}', expanded)
        return set(tokens)

    def _normalize_string(self, value: str) -> str:
        expanded = self._expand_bilingual_terms(value)
        return ' '.join(re.findall(r'[a-zA-Z_0-9]+', expanded))

    def _extract_identifiers(self, value: str) -> set[str]:
        expanded = self._expand_bilingual_terms(value)
        return set(re.findall(r'\b[a-zA-Z_][a-zA-Z0-9_]*\b', expanded))

    def _extract_question_function_name(self, question: str) -> str | None:
        patterns = [
            r'function\s+([a-zA-Z_][a-zA-Z0-9_]*)',
            r'def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(',
            r'write\s+(?:a\s+)?function\s+([a-zA-Z_][a-zA-Z0-9_]*)',
            r'implement\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(',
            r'create\s+(?:a\s+)?function\s+([a-zA-Z_][a-zA-Z0-9_]*)',
        ]
        lowered = self._expand_bilingual_terms(question)
        for pattern in patterns:
            match = re.search(pattern, lowered)
            if match:
                return match.group(1)

        if 'prime' in lowered:
            return 'is_prime'
        return None

    def _build_candidate_signals(self, question: str) -> dict[str, str | None]:
        function_name = self._extract_question_function_name(question)
        task_id_match = re.search(r'\b(?:task|problem)\s*(?:id)?\s*[:#]?\s*([a-zA-Z0-9_\-/]+)', question, re.IGNORECASE)
        return {
            'function_name': function_name,
            'task_id': task_id_match.group(1) if task_id_match else None,
        }

    def _sample_matches_signals(self, sample: EvaluationSample, signals: dict[str, str | None]) -> bool:
        function_name = signals.get('function_name')
        task_id = signals.get('task_id')

        if function_name:
            sample_entry = (sample.entry_point or str(sample.metadata.get('entry_point') or '')).lower()
            if sample_entry == function_name.lower():
                return True

        if task_id:
            normalized_task_id = task_id.lower()
            sample_task_id = str(sample.metadata.get('task_id') or sample.sample_id).lower()
            if normalized_task_id == sample_task_id or normalized_task_id in sample_task_id:
                return True

        return False

    def _estimate_test_count(self, test_code: str, language: Literal['python', 'c', 'cpp']) -> int:
        if not test_code.strip():
            return 1

        if language == 'python':
            count = len(re.findall(r'(^|\n)\s*assert\s+', test_code))
        else:
            count = len(re.findall(r'\bassert\s*\(', test_code))

        return max(1, count)

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

        question_identifiers = {identifier.lower() for identifier in self._extract_identifiers(question)}
        prompt_identifiers = {identifier.lower() for identifier in self._extract_identifiers(sample.prompt)}
        identifier_overlap = len(question_identifiers & prompt_identifiers)

        entry_bonus = 0.0
        if sample.entry_point and sample.entry_point.lower() in normalized_question:
            entry_bonus = 0.25

        task_bonus = 0.0
        task_id = str(sample.metadata.get('task_id') or sample.sample_id).lower()
        if task_id and task_id in normalized_question:
            task_bonus = 0.3

        dataset_bonus = 0.1 if sample.dataset_name in {'humaneval', 'mbpp', 'multipl_e_humaneval_cpp', 'multipl_e_mbpp_cpp'} else 0.0
        return overlap + coverage + ratio + (identifier_overlap * 0.2) + entry_bonus + task_bonus + dataset_bonus

    async def _find_matching_sample(
        self,
        question: str,
        language: Literal['python', 'c', 'cpp'],
    ) -> EvaluationSample | None:
        best_sample: EvaluationSample | None = None
        best_score = 0.0

        imported_rows = await benchmark_index_service.list_items(language)
        candidate_samples = [
            EvaluationSample(
                sample_id=item['id'],
                dataset_name=item['datasetName'],
                language=item['language'],
                prompt=item['prompt'],
                reference_solution=item.get('referenceSolution'),
                test_code=item['testCode'],
                entry_point=item.get('entryPoint'),
                metadata=_normalize_metadata(item.get('metadata')),
            )
            for item in imported_rows
        ] or self._load_samples()

        signals = self._build_candidate_signals(question)
        filtered_candidates = [sample for sample in candidate_samples if self._sample_matches_signals(sample, signals)]
        if filtered_candidates:
            logger.info(
                '[student-eval] narrowed benchmark candidates from %s to %s using signals=%s',
                len(candidate_samples),
                len(filtered_candidates),
                signals,
            )
            candidate_samples = filtered_candidates

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

    async def _get_benchmark_match_context(
        self,
        question: str,
        language: Literal['python', 'c', 'cpp'],
    ) -> dict[str, Any]:
        imported_rows = await benchmark_index_service.list_items(language)
        candidate_count = len(imported_rows)
        signals = self._build_candidate_signals(question)
        return {
            'language': language,
            'candidateCount': candidate_count,
            'signals': signals,
            'hasImportedBenchmarks': candidate_count > 0,
        }

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

    def _is_testable_cpp_code(self, code: str) -> bool:
        stripped = code.strip()
        if not stripped or 'cin >>' in stripped:
            return False
        if 'std::' in stripped:
            return True
        return bool(re.search(r'\b[a-zA-Z_][\w\s\*:<>,]+\s+[a-zA-Z_][\w]*\s*\([^\)]*\)\s*\{', stripped))

    def _extract_fallback_function_name(self, question: str, extracted_code: str, language: Literal['python', 'c', 'cpp']) -> str | None:
        if language == 'python':
            match = re.search(r'(^|\n)def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(', extracted_code)
            if match:
                return match.group(2)

        if language == 'cpp':
            match = re.search(r'^[ \t]*(?:[A-Za-z_][\w \t\*:&<>,]*)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\([^\)]*\)\s*\{', extracted_code, re.MULTILINE)
            if match:
                name = match.group(1)
                if name not in {'if', 'for', 'while', 'switch', 'main'}:
                    return name

        signaled = self._extract_question_function_name(question)
        if signaled:
            return signaled
        return None

    def _extract_parameter_names(self, extracted_code: str, language: Literal['python', 'c', 'cpp']) -> list[str]:
        if language == 'python':
            match = re.search(r'(^|\n)def\s+[a-zA-Z_][a-zA-Z0-9_]*\s*\(([^\)]*)\)', extracted_code)
            if not match:
                return []
            raw_params = [part.strip() for part in match.group(2).split(',') if part.strip()]
            names: list[str] = []
            for param in raw_params:
                param_name = param.split('=')[0].strip().lstrip('*')
                if ':' in param_name:
                    param_name = param_name.split(':', 1)[0].strip()
                if param_name:
                    names.append(param_name)
            return names

        if language == 'cpp':
            match = re.search(
                r'^[ \t]*(?:[A-Za-z_][\w \t\*:&<>,]*)\s+[A-Za-z_][a-zA-Z0-9_]*\s*\(([^\)]*)\)',
                extracted_code,
                re.MULTILINE,
            )
            if not match:
                return []
            raw_params = [part.strip() for part in match.group(1).split(',') if part.strip() and part.strip() != 'void']
            names: list[str] = []
            for param in raw_params:
                param = param.split('=')[0].strip()
                pieces = re.findall(r'[A-Za-z_][A-Za-z0-9_]*', param)
                if pieces:
                    names.append(pieces[-1])
            return names

        return []

    def _build_rule_based_fallback_sample(
        self,
        question: str,
        extracted_code: str,
        language: Literal['python', 'c', 'cpp'],
    ) -> EvaluationSample | None:
        if language not in {'python', 'cpp'}:
            return None

        entry_point = self._extract_fallback_function_name(question, extracted_code, language)
        if not entry_point:
            return None

        normalized_question = self._normalize_string(question)
        parameter_names = [name.lower() for name in self._extract_parameter_names(extracted_code, language)]
        lowered_entry = entry_point.lower()
        signals = {
            'entryPoint': entry_point,
            'parameterNames': parameter_names,
        }

        def has_any(*terms: str) -> bool:
            return any(term in normalized_question or term in lowered_entry for term in terms)

        def has_all(*terms: str) -> bool:
            return all(term in normalized_question or term in lowered_entry for term in terms)

        rule_id: str | None = None
        test_code = ''

        if len(parameter_names) == 2 and (
            has_any(' add ', ' sum ', 'tong', 'cong')
            or lowered_entry in {'add', 'sum', 'tong', 'cong'}
        ):
            rule_id = 'add_two_numbers'
            if language == 'python':
                test_code = (
                    f'assert {entry_point}(1, 2) == 3\n'
                    f'assert {entry_point}(0, 0) == 0\n'
                    f'assert {entry_point}(-5, 2) == -3\n'
                )
            else:
                test_code = (
                    '#include <cassert>\n\n'
                    'int main() {\n'
                    f'    auto candidate = {entry_point};\n'
                    '    assert(candidate(1, 2) == 3);\n'
                    '    assert(candidate(0, 0) == 0);\n'
                    '    assert(candidate(-5, 2) == -3);\n'
                    '    return 0;\n'
                    '}\n'
                )
        elif len(parameter_names) == 1 and (
            has_all('reverse', 'string')
            or lowered_entry in {'reverse_string', 'reverse', 'dao_chuoi'}
        ):
            rule_id = 'reverse_string'
            if language == 'python':
                test_code = (
                    f"assert {entry_point}('abc') == 'cba'\n"
                    f"assert {entry_point}('') == ''\n"
                    f"assert {entry_point}('a b') == 'b a'\n"
                )
            else:
                test_code = (
                    '#include <cassert>\n'
                    '#include <string>\n\n'
                    'int main() {\n'
                    f'    auto candidate = {entry_point};\n'
                    '    assert(candidate(std::string("abc")) == std::string("cba"));\n'
                    '    assert(candidate(std::string("")) == std::string(""));\n'
                    '    assert(candidate(std::string("a b")) == std::string("b a"));\n'
                    '    return 0;\n'
                    '}\n'
                )
        elif len(parameter_names) == 1 and (
            has_any('prime', 'is_prime')
            or lowered_entry in {'is_prime', 'prime', 'check_prime'}
        ):
            rule_id = 'prime_check'
            if language == 'python':
                test_code = (
                    f'assert {entry_point}(2) is True\n'
                    f'assert {entry_point}(4) is False\n'
                    f'assert {entry_point}(17) is True\n'
                    f'assert {entry_point}(1) is False\n'
                )
            else:
                test_code = (
                    '#include <cassert>\n\n'
                    'int main() {\n'
                    f'    auto candidate = {entry_point};\n'
                    '    assert(candidate(2) == true);\n'
                    '    assert(candidate(4) == false);\n'
                    '    assert(candidate(17) == true);\n'
                    '    assert(candidate(1) == false);\n'
                    '    return 0;\n'
                    '}\n'
                )
        elif len(parameter_names) == 1 and (
            has_any('factorial', 'giai_thua')
            or lowered_entry in {'factorial', 'giai_thua'}
        ):
            rule_id = 'factorial'
            if language == 'python':
                test_code = (
                    f'assert {entry_point}(0) == 1\n'
                    f'assert {entry_point}(1) == 1\n'
                    f'assert {entry_point}(5) == 120\n'
                )
            else:
                test_code = (
                    '#include <cassert>\n\n'
                    'int main() {\n'
                    f'    auto candidate = {entry_point};\n'
                    '    assert(candidate(0) == 1);\n'
                    '    assert(candidate(1) == 1);\n'
                    '    assert(candidate(5) == 120);\n'
                    '    return 0;\n'
                    '}\n'
                )
        elif len(parameter_names) == 2 and (
            has_any('gcd', 'ucln', 'greatest_common_divisor')
            or lowered_entry in {'gcd', 'ucln'}
        ):
            rule_id = 'gcd'
            if language == 'python':
                test_code = (
                    f'assert {entry_point}(54, 24) == 6\n'
                    f'assert {entry_point}(10, 5) == 5\n'
                    f'assert {entry_point}(17, 13) == 1\n'
                )
            else:
                test_code = (
                    '#include <cassert>\n\n'
                    'int main() {\n'
                    f'    auto candidate = {entry_point};\n'
                    '    assert(candidate(54, 24) == 6);\n'
                    '    assert(candidate(10, 5) == 5);\n'
                    '    assert(candidate(17, 13) == 1);\n'
                    '    return 0;\n'
                    '}\n'
                )
        elif len(parameter_names) == 1 and (
            has_any('palindrome', 'doi_xung')
            or lowered_entry in {'is_palindrome', 'palindrome'}
        ):
            rule_id = 'palindrome'
            if language == 'python':
                test_code = (
                    f"assert {entry_point}('aba') is True\n"
                    f"assert {entry_point}('abba') is True\n"
                    f"assert {entry_point}('abc') is False\n"
                )
            else:
                test_code = (
                    '#include <cassert>\n'
                    '#include <string>\n\n'
                    'int main() {\n'
                    f'    auto candidate = {entry_point};\n'
                    '    assert(candidate(std::string("aba")) == true);\n'
                    '    assert(candidate(std::string("abba")) == true);\n'
                    '    assert(candidate(std::string("abc")) == false);\n'
                    '    return 0;\n'
                    '}\n'
                )

        if not rule_id or not test_code:
            return None

        return EvaluationSample(
            sample_id=f'fallback/{language}/{rule_id}',
            dataset_name='rule_based_fallback',
            language=language,
            prompt=question,
            reference_solution=None,
            test_code=test_code,
            entry_point=entry_point,
            metadata={
                'source': 'rule_based_fallback',
                'phase': 1,
                'rule_id': rule_id,
                'synthetic': True,
                'entry_point': entry_point,
            },
        )

    def _build_unavailable_response(
        self,
        language: Literal['python', 'c', 'cpp'],
        benchmark_context: dict[str, Any],
    ) -> dict[str, Any]:
        signals = benchmark_context.get('signals') or {}
        display_language = 'C++' if language == 'cpp' else language.upper() if language == 'python' else language
        if not benchmark_context.get('hasImportedBenchmarks'):
            rationale = f'Chưa có benchmark ngôn ngữ {display_language} được nạp trong hệ thống để đánh giá tự động.'
        elif signals.get('function_name'):
            rationale = (
                f"Đã tìm benchmark {display_language} nhưng chưa match được bài có hàm `{signals['function_name']}`. "
                'Hãy hỏi sát tên hàm hoặc nạp thêm dataset benchmark phù hợp.'
            )
        else:
            rationale = (
                f'Đã dò {benchmark_context.get("candidateCount", 0)} benchmark {display_language} nhưng chưa tìm được đề tương đồng đủ gần để chấm tự động.'
            )
        return {
            'score': 0,
            'status': 'unavailable',
            'language': language,
            'rationale': rationale,
            'passed': 0,
            'total': 0,
            'executionTimeMs': 0,
            'stderr': '',
            'stdout': '',
            'testCode': '',
            'benchmark': {
                'candidateCount': benchmark_context.get('candidateCount', 0),
                'signals': benchmark_context.get('signals'),
            },
            'modelUsed': None,
        }

    def _execute_sample(
        self,
        extracted_code: str,
        language: Literal['python', 'c', 'cpp'],
        sample: EvaluationSample,
        *,
        fallback: bool = False,
    ) -> dict[str, Any]:
        logger.info('[student-eval] matched %s sample %s from %s', 'fallback' if fallback else 'benchmark', sample.sample_id, sample.dataset_name)
        result = self.sandbox.execute(
            SandboxExecutionRequest(
                language=language,
                source_code=extracted_code,
                test_code=sample.test_code,
                entry_point=sample.entry_point,
                sample_id=f'student_eval_{sample.sample_id.replace("/", "_")}',
            )
        )

        total = self._estimate_test_count(sample.test_code, language)
        passed = total if result.status == 'passed' else 0
        score = round(100 * passed / total) if total > 0 else 0
        response = {
            'score': score,
            'status': result.status,
            'language': language,
            'rationale': (
                f'Không tìm thấy benchmark phù hợp; đã chấm bằng deterministic rule-based fallback phase 1 cho `{sample.metadata.get("rule_id")}`.'
                if fallback
                else f'Đã đối chiếu với benchmark {sample.dataset_name}:{sample.sample_id}.'
            ),
            'passed': passed,
            'total': total,
            'executionTimeMs': result.execution_time_ms,
            'stderr': result.stderr,
            'stdout': result.stdout,
            'testCode': sample.test_code,
            'benchmark': {
                'datasetName': sample.dataset_name,
                'sampleId': sample.sample_id,
                'entryPoint': sample.entry_point,
                'source': sample.metadata.get('source'),
                **(
                    {
                        'ruleId': sample.metadata.get('rule_id'),
                        'phase': sample.metadata.get('phase'),
                        'synthetic': sample.metadata.get('synthetic'),
                    }
                    if fallback
                    else {}
                ),
            },
            'modelUsed': None,
        }
        self.sandbox.cleanup(result)
        return response

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
        job = await student_programming_chat_service.get_evaluation_job(job_id, user_id)
        if job is None:
            return

        metadata = job.get('metadata') or {}
        question = metadata.get('question', '')
        answer = metadata.get('answer', '')
        language = self.infer_language(question, answer, metadata.get('language'))

        await student_programming_chat_service.update_evaluation_job(
            job_id,
            user_id,
            {
                'status': 'running',
                'language': language,
                'metadata': {'stage': 'matching-dataset'},
            },
        )

        try:
            benchmark_context = await self._get_benchmark_match_context(question, language)
            sample = await self._find_matching_sample(question, language)
            result = await self._evaluate_answer(
                question,
                answer,
                language,
                benchmark_context,
                sample,
            )
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
            error_message = str(exc).strip() or f'{exc.__class__.__name__}: unknown evaluation failure'
            await student_programming_chat_service.update_evaluation_job(
                job_id,
                user_id,
                {
                    'status': 'failed',
                    'language': language,
                    'errorMessage': error_message,
                    'rationale': 'Không thể hoàn tất đánh giá tự động.',
                    'metadata': {
                        'stage': 'failed',
                        'errorMessage': error_message,
                    },
                    'completedAt': True,
                },
            )

    async def _evaluate_answer(
        self,
        question: str,
        answer: str,
        language: Literal['python', 'c', 'cpp'],
        benchmark_context: dict[str, Any],
        sample: EvaluationSample | None,
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
                'benchmark': None,
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
                'benchmark': None,
            }

        if language == 'cpp' and not self._is_testable_cpp_code(extracted_code):
            return {
                'score': 0,
                'status': 'unavailable',
                'language': language,
                'rationale': 'Chưa có dữ liệu để đánh giá tự động cho câu trả lời C++ này.',
                'passed': 0,
                'total': 0,
                'executionTimeMs': 0,
                'stderr': '',
                'stdout': '',
                'testCode': '',
                'modelUsed': None,
                'benchmark': None,
            }

        if sample is None:
            fallback_sample = self._build_rule_based_fallback_sample(question, extracted_code, language)
            if fallback_sample is None:
                return self._build_unavailable_response(language, benchmark_context)
            return await asyncio.to_thread(
                self._execute_sample,
                extracted_code,
                language,
                fallback_sample,
                fallback=True,
            )

        return await asyncio.to_thread(
            self._evaluate_answer_sync,
            question,
            answer,
            language,
            benchmark_context,
            sample,
        )

    def _evaluate_answer_sync(
        self,
        question: str,
        answer: str,
        language: Literal['python', 'c', 'cpp'],
        benchmark_context: dict[str, Any],
        sample: EvaluationSample | None,
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
                'benchmark': None,
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
                'benchmark': None,
            }

        if language == 'cpp' and not self._is_testable_cpp_code(extracted_code):
            return {
                'score': 0,
                'status': 'unavailable',
                'language': language,
                'rationale': 'Chưa có dữ liệu để đánh giá tự động cho câu trả lời C++ này.',
                'passed': 0,
                'total': 0,
                'executionTimeMs': 0,
                'stderr': '',
                'stdout': '',
                'testCode': '',
                'modelUsed': None,
                'benchmark': None,
            }

        if sample is None:
            fallback_sample = self._build_rule_based_fallback_sample(question, extracted_code, language)
            if fallback_sample is None:
                return self._build_unavailable_response(language, benchmark_context)
            return self._execute_sample(
                extracted_code,
                language,
                fallback_sample,
                fallback=True,
            )

        return self._execute_sample(
            extracted_code,
            language,
            sample,
        )


student_programming_evaluation_service = StudentProgrammingEvaluationService()
