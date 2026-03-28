from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


SupportedLanguage = Literal['python', 'c']
SupportedDataset = Literal['humaneval', 'mbpp']


class EvaluationSample(BaseModel):
    sample_id: str = Field(description='Stable benchmark item id')
    dataset_name: SupportedDataset = Field(description='Dataset source name')
    language: SupportedLanguage = Field(description='Programming language')
    prompt: str = Field(description='Prompt sent to the tutor model')
    reference_solution: str | None = Field(
        default=None,
        description='Optional canonical solution if dataset provides one',
    )
    test_code: str = Field(description='Unit test or checker snippet')
    entry_point: str | None = Field(
        default=None,
        description='Function entry point expected by the dataset',
    )
    metadata: dict[str, str | int | float | bool | None] = Field(
        default_factory=dict,
        description='Extra normalized metadata for reporting/debugging',
    )
