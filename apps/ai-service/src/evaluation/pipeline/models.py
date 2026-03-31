from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class BenchmarkSampleResult(BaseModel):
    sample_id: str
    dataset_name: str
    language: str
    status: str
    execution_time_ms: float
    elapsed_time_ms: float
    stdout: str = ''
    stderr: str = ''
    prompt: str
    raw_response: str
    extracted_code: str
    model_used: str
    confidence: float | None = None
    sources: list[dict[str, Any]] = Field(default_factory=list)


class BenchmarkReport(BaseModel):
    dataset: str
    model_type: str
    sample_count: int
    pass_rate: float
    pass_at_1: float
    code_bleu: dict[str, Any]
    total_execution_time_ms: float
    average_execution_time_ms: float
    results: list[BenchmarkSampleResult]
