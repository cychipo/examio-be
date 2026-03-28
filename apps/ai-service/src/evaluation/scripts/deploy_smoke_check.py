from __future__ import annotations

from pathlib import Path

import typer

from .run_benchmark import main as run_benchmark_main

app = typer.Typer(add_completion=False)


@app.command()
def main() -> None:
    run_benchmark_main(
        dataset='humaneval',
        model_type='qwen3_8b',
        limit=2,
        dataset_path=str(Path('src/evaluation/datasets/samples/humaneval_smoke.jsonl')),
        fast_mode=True,
        report_name='deploy_smoke_report.json',
        report_dir=str(Path('src/evaluation/reports')),
    )


if __name__ == '__main__':
    app()
