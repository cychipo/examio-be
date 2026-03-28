from __future__ import annotations

from pathlib import Path

from src.evaluation.pipeline.benchmark_runner import BenchmarkRunner


class MockTutorClient:
    def generate_code(self, sample, model_type: str, fast_mode: bool = False):
        mapping = {
            'HumanEval/0': {
                'answer': '```python\ndef add(a, b):\n    return a + b\n```',
                'modelUsed': model_type,
                'confidence': 0.95,
                'sources': [],
            },
            'HumanEval/1': {
                'answer': 'def is_even(n):\n    return n % 2 == 0\n',
                'modelUsed': model_type,
                'confidence': 0.91,
                'sources': [],
            },
        }
        return mapping[sample.sample_id]


def test_benchmark_runner_smoke_humaneval(tmp_path: Path):
    runner = BenchmarkRunner()
    runner.tutor_client = MockTutorClient()
    runner.sandbox.temp_root = tmp_path

    report = runner.run(
        dataset_name='humaneval',
        model_type='qwen3_8b',
        limit=2,
        dataset_path=Path('src/evaluation/datasets/samples/humaneval_smoke.jsonl'),
        fast_mode=True,
    )

    assert report['dataset'] == 'humaneval'
    assert report['sample_count'] == 2
    assert report['pass_rate'] == 1.0
    assert report['pass_at_1'] == 1.0
    assert len(report['results']) == 2
    assert report['results'][0]['extracted_code']
