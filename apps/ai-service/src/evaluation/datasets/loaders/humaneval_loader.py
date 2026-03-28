from __future__ import annotations

import json
from pathlib import Path

from src.evaluation.datasets.schemas import EvaluationSample


def load_humaneval_samples(file_path: Path, limit: int | None = None) -> list[EvaluationSample]:
    samples: list[EvaluationSample] = []
    with file_path.open('r', encoding='utf-8') as handle:
        for index, line in enumerate(handle):
            if limit is not None and index >= limit:
                break

            row = json.loads(line)
            samples.append(
                EvaluationSample(
                    sample_id=row['task_id'],
                    dataset_name='humaneval',
                    language='python',
                    prompt=row['prompt'],
                    reference_solution=row.get('canonical_solution'),
                    test_code=row['test'],
                    entry_point=row.get('entry_point'),
                    metadata={
                        'source': 'HumanEval',
                    },
                )
            )
    return samples
