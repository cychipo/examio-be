from __future__ import annotations

import shutil
import subprocess
import time
from pathlib import Path

from ..config.settings import settings
from .models import (
    SandboxExecutionRequest,
    SandboxExecutionResult,
)
from .utils import create_workdir, write_text


class ExecutionSandbox:
    def __init__(self, temp_root: Path | None = None) -> None:
        self.temp_root = temp_root or settings.temp_root

    def execute(self, request: SandboxExecutionRequest) -> SandboxExecutionResult:
        if request.language == 'python':
            return self._execute_python(request)
        if request.language == 'c':
            return self._execute_c(request)
        raise ValueError(f'Unsupported language: {request.language}')

    def _execute_python(self, request: SandboxExecutionRequest) -> SandboxExecutionResult:
        workdir = create_workdir(self.temp_root, request.sample_id)
        main_path = write_text(workdir / 'solution.py', request.source_code)
        test_path = write_text(
            workdir / 'test_runner.py',
            f"from solution import *\n\n{request.test_code}\n",
        )
        return self._run_process(
            [settings.python_bin, str(test_path)],
            workdir=workdir,
        )

    def _execute_c(self, request: SandboxExecutionRequest) -> SandboxExecutionResult:
        workdir = create_workdir(self.temp_root, request.sample_id)
        source_path = write_text(
            workdir / 'solution.c',
            f"{request.source_code}\n\n{request.test_code}\n",
        )
        binary_path = workdir / 'solution.out'

        compile_result = self._run_process(
            [settings.gcc_bin, str(source_path), '-O2', '-std=c11', '-o', str(binary_path)],
            workdir=workdir,
            timeout_seconds=settings.compile_timeout_seconds,
        )
        if compile_result.status != 'passed':
            compile_result.status = 'compile_error'
            return compile_result

        runtime_result = self._run_process(
            [str(binary_path)],
            workdir=workdir,
            timeout_seconds=settings.run_timeout_seconds,
        )
        runtime_result.binary_path = binary_path
        return runtime_result

    def cleanup(self, result: SandboxExecutionResult) -> None:
        if result.working_directory and result.working_directory.exists():
            shutil.rmtree(result.working_directory, ignore_errors=True)

    def _run_process(
        self,
        command: list[str],
        workdir: Path,
        timeout_seconds: int | None = None,
    ) -> SandboxExecutionResult:
        started_at = time.perf_counter()
        try:
            completed = subprocess.run(
                command,
                cwd=workdir,
                capture_output=True,
                text=True,
                timeout=timeout_seconds or settings.run_timeout_seconds,
                check=False,
            )
            duration_ms = (time.perf_counter() - started_at) * 1000
            status = 'passed' if completed.returncode == 0 else 'runtime_error'
            return SandboxExecutionResult(
                status=status,
                stdout=completed.stdout,
                stderr=completed.stderr,
                exit_code=completed.returncode,
                execution_time_ms=duration_ms,
                working_directory=workdir,
            )
        except subprocess.TimeoutExpired as exc:
            duration_ms = (time.perf_counter() - started_at) * 1000
            return SandboxExecutionResult(
                status='timeout',
                stdout=exc.stdout or '',
                stderr=exc.stderr or '',
                exit_code=None,
                execution_time_ms=duration_ms,
                working_directory=workdir,
            )
