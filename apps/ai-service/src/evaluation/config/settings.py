from __future__ import annotations

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class EvaluationSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix='EVAL_',
        env_file='.env',
        extra='ignore',
    )

    tutor_base_url: str = Field(
        default='http://127.0.0.1:8000/api/tutor',
        description='Base URL of ai-tutor-service endpoints',
    )
    request_timeout_seconds: int = Field(default=180)
    sample_limit: int = Field(default=10)
    pass_k: int = Field(default=1)
    runtime_root: Path = Field(default=Path('data-source/evaluation'))
    temp_root: Path = Field(default=Path('data-source/evaluation/tmp'))
    report_root: Path = Field(default=Path('data-source/evaluation/reports'))
    humaneval_path: Path = Field(
        default=Path('src/evaluation/datasets/samples/humaneval.jsonl')
    )
    mbpp_path: Path = Field(
        default=Path('src/evaluation/datasets/samples/mbpp.jsonl')
    )
    gcc_bin: str = Field(default='gcc')
    python_bin: str = Field(default='python3')
    compile_timeout_seconds: int = Field(default=15)
    run_timeout_seconds: int = Field(default=15)


settings = EvaluationSettings()
