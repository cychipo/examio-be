from __future__ import annotations

import time
from pathlib import Path
from typing import Any

from ..clients.tutor_client import TutorClient
from ..config.settings import settings
from ..datasets.loaders.humaneval_loader import load_humaneval_samples
from ..datasets.loaders.mbpp_loader import load_mbpp_samples
from ..metrics.codebleu import compute_codebleu_score
from ..metrics.pass_at_k import estimate_pass_at_k
from ..pipeline.code_extractor import extract_code_block
from ..pipeline.models import BenchmarkReport, BenchmarkSampleResult
from ..sandbox.executor import ExecutionSandbox
from ..sandbox.models import SandboxExecutionRequest


class BenchmarkRunner:
    def __init__(self) -> None:
        self.sandbox = ExecutionSandbox()
        self.tutor_client = TutorClient()

    def load_samples(
        self,
        dataset_name: str,
        limit: int | None = None,
        dataset_path: Path | None = None,
    ):
        if dataset_name == 'humaneval':
            return load_humaneval_samples(dataset_path or settings.humaneval_path, limit=limit)
        if dataset_name == 'mbpp':
            return load_mbpp_samples(dataset_path or settings.mbpp_path, limit=limit)
        raise ValueError(f'Unsupported dataset: {dataset_name}')

    def run(
        self,
        dataset_name: str,
        model_type: str,
        limit: int | None = None,
        dataset_path: Path | None = None,
        fast_mode: bool = True,
    ) -> dict[str, Any]:
        samples = self.load_samples(
            dataset_name,
            limit=limit or settings.sample_limit,
            dataset_path=dataset_path,
        )
        results: list[BenchmarkSampleResult] = []
        predictions: list[str] = []
        references: list[str] = []
        passed = 0
        total_execution_time_ms = 0.0

        for sample in samples:
            started_at = time.perf_counter()
            tutor_response = self.tutor_client.generate_code(
                sample=sample,
                model_type=model_type,
                fast_mode=fast_mode,
            )
            raw_response = tutor_response.get('answer', '')
            generated_code = extract_code_block(raw_response, sample.language)
            execution_result = self.sandbox.execute(
                SandboxExecutionRequest(
                    language=sample.language,
                    source_code=generated_code,
                    test_code=sample.test_code,
                    entry_point=sample.entry_point,
                    sample_id=sample.sample_id,
                )
            )
            elapsed_ms = (time.perf_counter() - started_at) * 1000
            total_execution_time_ms += elapsed_ms

            if execution_result.status == 'passed':
                passed += 1

            predictions.append(generated_code)
            references.append(sample.reference_solution or '')
            results.append(
                BenchmarkSampleResult(
                    sample_id=sample.sample_id,
                    dataset_name=sample.dataset_name,
                    language=sample.language,
                    status=execution_result.status,
                    execution_time_ms=execution_result.execution_time_ms,
                    elapsed_time_ms=elapsed_ms,
                    stdout=execution_result.stdout,
                    stderr=execution_result.stderr,
                    prompt=sample.prompt,
                    raw_response=raw_response,
                    extracted_code=generated_code,
                    model_used=tutor_response.get('modelUsed', model_type),
                    confidence=tutor_response.get('confidence'),
                    sources=tutor_response.get('sources') or [],
                )
            )
            self.sandbox.cleanup(execution_result)

        codebleu = compute_codebleu_score(predictions, references, 'python')

        report = BenchmarkReport(
            dataset=dataset_name,
            model_type=model_type,
            sample_count=len(samples),
            pass_rate=(passed / len(samples)) if samples else 0.0,
            pass_at_1=estimate_pass_at_k(len(samples), passed, 1) if samples else 0.0,
            code_bleu=codebleu,
            total_execution_time_ms=total_execution_time_ms,
            average_execution_time_ms=(total_execution_time_ms / len(samples)) if samples else 0.0,
            results=results,
        )
        payload = report.model_dump(mode='json')
        payload['datasetPath'] = str(dataset_path) if dataset_path else None
        payload['fastMode'] = fast_mode
        return payload
