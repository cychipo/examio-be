from __future__ import annotations

import typer

from pathlib import Path
import sys

if __package__ in {None, ''}:  # pragma: no cover
    sys.path.append(str(Path(__file__).resolve().parents[2]))
    from evaluation.config.settings import settings
    from evaluation.pipeline.benchmark_runner import BenchmarkRunner
    from evaluation.pipeline.report_writer import write_report
else:
    from ..config.settings import settings
    from ..pipeline.benchmark_runner import BenchmarkRunner
    from ..pipeline.report_writer import write_report

app = typer.Typer(add_completion=False)


@app.command()
def main(
    dataset: str = typer.Option('humaneval', help='Dataset name: humaneval or mbpp'),
    model_type: str = typer.Option('qwen3_8b', help='Tutor model id'),
    limit: int = typer.Option(10, help='Number of samples to run'),
    dataset_path: str | None = typer.Option(None, help='Optional custom dataset file path'),
    fast_mode: bool = typer.Option(True, help='Enable tutor fast mode for lower latency'),
    report_name: str = typer.Option('report.json', help='Output report filename'),
    report_dir: str | None = typer.Option(None, help='Optional report output directory'),
) -> None:
    runner = BenchmarkRunner()
    resolved_dataset_path = Path(dataset_path) if dataset_path else None
    report = runner.run(
        dataset_name=dataset,
        model_type=model_type,
        limit=limit,
        dataset_path=resolved_dataset_path,
        fast_mode=fast_mode,
    )
    output_root = Path(report_dir) if report_dir else settings.report_root
    output_path = write_report(output_root, report_name, report)
    typer.echo(f'Report written to: {output_path}')


if __name__ == '__main__':
    app()
