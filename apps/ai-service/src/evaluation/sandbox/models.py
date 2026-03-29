from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field


SandboxLanguage = Literal['python', 'c', 'cpp']
ExecutionStatus = Literal['passed', 'failed', 'compile_error', 'runtime_error', 'timeout']


class SandboxExecutionRequest(BaseModel):
    language: SandboxLanguage
    source_code: str = Field(description='Raw generated code from AI tutor')
    test_code: str = Field(description='Harness or assertions for the sample')
    entry_point: str | None = Field(default=None)
    sample_id: str = Field(description='Benchmark sample identifier')


class SandboxExecutionResult(BaseModel):
    status: ExecutionStatus
    stdout: str = ''
    stderr: str = ''
    exit_code: int | None = None
    execution_time_ms: float = 0.0
    working_directory: Path | None = None
    binary_path: Path | None = None
