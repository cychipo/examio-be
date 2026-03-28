from __future__ import annotations

import difflib
from typing import Any


def compute_codebleu_score(
    predictions: list[str],
    references: list[str],
    language: str,
) -> dict[str, Any]:
    try:
        import codebleu  # type: ignore[import-not-found]

        calc_codebleu = getattr(codebleu, 'calc_codebleu')

        return calc_codebleu(
            references=[[reference] for reference in references],
            predictions=predictions,
            lang=language,
        )
    except Exception as exc:
        similarity = 0.0
        if predictions and references and len(predictions) == len(references):
            scores = [
                difflib.SequenceMatcher(None, prediction, reference).ratio()
                for prediction, reference in zip(predictions, references)
            ]
            similarity = sum(scores) / len(scores) if scores else 0.0

        return {
            'codebleu': similarity,
            'error': str(exc),
            'language': language,
            'fallback': 'sequence_matcher',
        }
