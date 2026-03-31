from __future__ import annotations

from math import comb


def estimate_pass_at_k(total_samples: int, passed_samples: int, k: int) -> float:
    if total_samples <= 0:
        return 0.0
    if total_samples - passed_samples < k:
        return 1.0
    return 1.0 - (comb(total_samples - passed_samples, k) / comb(total_samples, k))
