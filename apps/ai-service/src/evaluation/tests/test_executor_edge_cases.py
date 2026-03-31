from __future__ import annotations

from pathlib import Path

from src.evaluation.sandbox.executor import ExecutionSandbox
from src.evaluation.sandbox.models import SandboxExecutionRequest


def test_c_executor_compile_error(tmp_path: Path):
    sandbox = ExecutionSandbox(temp_root=tmp_path)
    result = sandbox.execute(
        SandboxExecutionRequest(
            language='c',
            source_code='int main(void) { return ; }',
            test_code='',
            sample_id='c_compile_error',
        )
    )

    assert result.status in {'compile_error', 'runtime_error'}
    assert result.stderr
    sandbox.cleanup(result)


def test_python_executor_runtime_error(tmp_path: Path):
    sandbox = ExecutionSandbox(temp_root=tmp_path)
    result = sandbox.execute(
        SandboxExecutionRequest(
            language='python',
            source_code='def divide(a, b):\n    return a / b\n',
            test_code='divide(1, 0)',
            sample_id='python_runtime_error',
        )
    )

    assert result.status == 'runtime_error'
    assert 'ZeroDivisionError' in result.stderr
    sandbox.cleanup(result)


def test_python_executor_timeout(tmp_path: Path):
    sandbox = ExecutionSandbox(temp_root=tmp_path)
    result = sandbox.execute(
        SandboxExecutionRequest(
            language='python',
            source_code='def spin():\n    while True:\n        pass\n',
            test_code='spin()',
            sample_id='python_timeout',
        )
    )

    assert result.status == 'timeout'
    sandbox.cleanup(result)


def test_cpp_executor_compile_error(tmp_path: Path):
    sandbox = ExecutionSandbox(temp_root=tmp_path)
    result = sandbox.execute(
        SandboxExecutionRequest(
            language='cpp',
            source_code='int main() { std::vector<int> values = {1, 2}; return 0; }',
            test_code='',
            sample_id='cpp_compile_error',
        )
    )

    assert result.status in {'compile_error', 'runtime_error'}
    assert result.stderr
    sandbox.cleanup(result)
