from __future__ import annotations

from typing import Any

import requests

from ..config.settings import settings
from ..datasets.schemas import EvaluationSample


class TutorClient:
    def __init__(self, base_url: str | None = None, timeout_seconds: int | None = None) -> None:
        self.base_url = (base_url or settings.tutor_base_url).rstrip('/')
        self.timeout_seconds = timeout_seconds or settings.request_timeout_seconds

    def generate_code(
        self,
        sample: EvaluationSample,
        model_type: str,
        fast_mode: bool = False,
    ) -> dict[str, Any]:
        response = requests.post(
            f'{self.base_url}/query',
            json={
                'query': sample.prompt,
                'history': [],
                'language': sample.language,
                'topK': 2,
                'modelType': model_type,
                'fastMode': fast_mode,
            },
            timeout=self.timeout_seconds,
        )
        response.raise_for_status()
        return response.json()
