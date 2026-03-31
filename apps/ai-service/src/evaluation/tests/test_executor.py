from __future__ import annotations

from pathlib import Path

from src.evaluation.sandbox.executor import ExecutionSandbox
from src.evaluation.sandbox.models import SandboxExecutionRequest


def test_python_executor_passes(tmp_path: Path):
    sandbox = ExecutionSandbox(temp_root=tmp_path)
    result = sandbox.execute(
        SandboxExecutionRequest(
            language='python',
            source_code='def add(a, b):\n    return a + b\n',
            test_code='assert add(1, 2) == 3',
            sample_id='python_add',
        )
    )

    assert result.status == 'passed'
    sandbox.cleanup(result)


def test_c_executor_passes(tmp_path: Path):
    sandbox = ExecutionSandbox(temp_root=tmp_path)
    result = sandbox.execute(
        SandboxExecutionRequest(
            language='c',
            source_code='''
#include <assert.h>
int add(int a, int b) { return a + b; }
int main(void) {
    assert(add(1, 2) == 3);
    return 0;
}
''',
            test_code='',
            sample_id='c_add',
        )
    )

    assert result.status == 'passed'
    sandbox.cleanup(result)


def test_cpp_executor_passes(tmp_path: Path):
    sandbox = ExecutionSandbox(temp_root=tmp_path)
    result = sandbox.execute(
        SandboxExecutionRequest(
            language='cpp',
            source_code='''
#include <vector>
using namespace std;

vector<int> running_sum(const vector<int>& nums) {
    vector<int> result;
    int current = 0;
    for (int value : nums) {
        current += value;
        result.push_back(current);
    }
    return result;
}

int main() {
    vector<int> result = running_sum({1, 2, 3});
    return result.size() == 3 && result[2] == 6 ? 0 : 1;
}
''',
            test_code='',
            sample_id='cpp_running_sum',
        )
    )

    assert result.status == 'passed'
    sandbox.cleanup(result)


def test_cpp_executor_adapts_candidate_assert_harness(tmp_path: Path):
    sandbox = ExecutionSandbox(temp_root=tmp_path)
    result = sandbox.execute(
        SandboxExecutionRequest(
            language='cpp',
            source_code='''
bool is_prime(long n) {
    if (n < 2) return false;
    if (n == 2) return true;
    if (n % 2 == 0) return false;
    for (long i = 3; i * i <= n; i += 2) {
        if (n % i == 0) return false;
    }
    return true;
}
''',
            test_code='''
}
int main() {
    auto candidate = is_prime;
    assert(candidate(6) == false);
    assert(candidate(101) == true);
    return 0;
}
''',
            entry_point='is_prime',
            sample_id='cpp_prime_candidate',
        )
    )

    assert result.status == 'passed'
    sandbox.cleanup(result)
