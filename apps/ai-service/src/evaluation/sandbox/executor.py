from __future__ import annotations

import re
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

    def _adapt_cpp_source(self, source_code: str, entry_point: str | None, test_code: str) -> tuple[str, str]:
        adapted = source_code.strip()
        adapted_test_code = test_code
        if '#include <cassert>' not in adapted and '#include <assert.h>' not in adapted:
            adapted = '#include <cassert>\n' + adapted

        if entry_point and re.match(r'^\s*}\s*', adapted_test_code):
            adapted = adapted.rstrip()
            if adapted.endswith('}'):
                adapted_test_code = re.sub(r'^\s*}\s*', '', adapted_test_code, count=1)

        if entry_point and 'candidate(' in adapted_test_code and 'candidate(' not in adapted:
            alias_pattern = re.compile(rf'\b(auto|bool|int|long|float|double|char|std::[\w:<>]+|[A-Za-z_][\w:<>]*)\s+candidate\s*\(')
            signature_pattern = re.compile(
                rf'^[ \t]*(?P<return_type>[A-Za-z_][\w \t\*:&<>,]*)\s+{re.escape(entry_point)}\s*\((?P<params>[^\)]*)\)',
                re.MULTILINE,
            )
            signature_match = signature_pattern.search(adapted)
            if not alias_pattern.search(adapted) and signature_match:
                return_type = ' '.join(signature_match.group('return_type').split())
                params = signature_match.group('params').strip()
                arg_names: list[str] = []
                if params and params != 'void':
                    for raw_param in params.split(','):
                        param = raw_param.strip()
                        if not param:
                            continue
                        param = param.split('=')[0].strip()
                        pieces = re.findall(r'[A-Za-z_][A-Za-z0-9_]*', param)
                        if pieces:
                            arg_names.append(pieces[-1])
                candidate_params = params if params else 'void'
                candidate_args = ', '.join(arg_names)
                adapted += (
                    f'\n\n{return_type} candidate({candidate_params}) {{ '
                    f'return {entry_point}({candidate_args}); }}\n'
                )

        return adapted, adapted_test_code

    def execute(self, request: SandboxExecutionRequest) -> SandboxExecutionResult:
        if request.language == 'python':
            return self._execute_python(request)
        if request.language == 'c':
            return self._execute_c(request)
        if request.language == 'cpp':
            return self._execute_cpp(request)
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

    def _execute_cpp(self, request: SandboxExecutionRequest) -> SandboxExecutionResult:
        workdir = create_workdir(self.temp_root, request.sample_id)
        adapted_source, adapted_test_code = self._adapt_cpp_source(
            request.source_code,
            request.entry_point,
            request.test_code,
        )
        source_path = write_text(
            workdir / 'solution.cpp',
            f"{adapted_source}\n\n{adapted_test_code}\n",
        )
        binary_path = workdir / 'solution.out'

        compile_result = self._run_process(
            [settings.gpp_bin, str(source_path), '-O2', '-std=c++17', '-o', str(binary_path)],
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
        except FileNotFoundError as exc:
            duration_ms = (time.perf_counter() - started_at) * 1000
            return SandboxExecutionResult(
                status='runtime_error',
                stdout='',
                stderr=str(exc) or f'Executable not found: {command[0]}',
                exit_code=None,
                execution_time_ms=duration_ms,
                working_directory=workdir,
            )
        except PermissionError as exc:
            duration_ms = (time.perf_counter() - started_at) * 1000
            return SandboxExecutionResult(
                status='runtime_error',
                stdout='',
                stderr=str(exc) or f'Permission denied while running: {command[0]}',
                exit_code=None,
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
