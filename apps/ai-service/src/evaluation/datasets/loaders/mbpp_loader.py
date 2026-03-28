from __future__ import annotations

import json
from pathlib import Path

from src.evaluation.datasets.schemas import EvaluationSample


def load_mbpp_samples(file_path: Path, limit: int | None = None) -> list[EvaluationSample]:
    data = json.loads(file_path.read_text(encoding='utf-8'))
    rows = data[:limit] if limit is not None else data
    samples: list[EvaluationSample] = []

    for row in rows:
        prompt_parts = [row['text']]
        test_list = row.get('test_list') or []
        if test_list:
            prompt_parts.append('Use the following sample assertions as guidance:')
            prompt_parts.extend(test_list)

        samples.append(
            EvaluationSample(
                sample_id=f"mbpp_{row['task_id']}",
                dataset_name='mbpp',
                language='python',
                prompt='\n'.join(prompt_parts),
                reference_solution=row.get('code'),
                test_code='\n'.join(test_list),
                entry_point=None,
                metadata={
                    'source': 'MBPP',
                    'task_id': row['task_id'],
                },
            )
        )

    return samples
