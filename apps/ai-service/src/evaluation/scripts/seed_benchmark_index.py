from __future__ import annotations

from pathlib import Path
import sys

import typer

if __package__ in {None, ''}:  # pragma: no cover
    sys.path.append(str(Path(__file__).resolve().parents[2]))
    from evaluation.datasets.loaders.humaneval_loader import load_humaneval_samples
    from evaluation.datasets.loaders.mbpp_loader import load_mbpp_samples
    from src.backend.services.benchmark_index_service import benchmark_index_service
else:
    from ..datasets.loaders.humaneval_loader import load_humaneval_samples
    from ..datasets.loaders.mbpp_loader import load_mbpp_samples
    from ...backend.services.benchmark_index_service import benchmark_index_service

app = typer.Typer(add_completion=False)


@app.command()
def main(
    dataset: str = typer.Option(..., help='humaneval or mbpp'),
    dataset_path: str = typer.Option(..., help='Path to dataset file'),
    limit: int | None = typer.Option(None, help='Optional max number of samples to seed'),
) -> None:
    path = Path(dataset_path)
    if not path.exists():
        raise typer.BadParameter(f'Dataset file not found: {path}')

    if dataset == 'humaneval':
        samples = load_humaneval_samples(path, limit=limit)
    elif dataset == 'mbpp':
        samples = load_mbpp_samples(path, limit=limit)
    else:
        raise typer.BadParameter('dataset must be humaneval or mbpp')

    async def seed() -> None:
        await benchmark_index_service.ensure_schema()
        for sample in samples:
            await benchmark_index_service.upsert_item(sample, source_path=str(path))

    import asyncio

    asyncio.run(seed())
    typer.echo(f'Seeded {len(samples)} benchmark items from {path}')


if __name__ == '__main__':
    app()
