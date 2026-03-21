"""Benchmark generation retrieval modes without changing public APIs.

The script compares how `vector` and `hybrid` select source chunks for quiz or
flashcard generation. It focuses on retrieval quality and estimated generation
shape rather than invoking the full LLM generation pipeline.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

CURRENT_FILE = Path(__file__).resolve()
PROJECT_ROOT = CURRENT_FILE.parents[3]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.append(str(PROJECT_ROOT))

from src.backend.services.generation_service import generation_service  # noqa: E402
from src.backend.services.hybrid_retrieval_service import (  # noqa: E402
    RetrievalResult,
    hybrid_retrieval_service,
)
from src.backend.services.ocr_service import ocr_service  # noqa: E402


@dataclass
class GenerationBenchmarkRow:
    mode: str
    generation_type: str
    requested_items: int
    keyword: Optional[str]
    elapsed_ms: int
    selected_chunks: int
    total_chunks: int
    seed_chunks: int
    distribution: List[int]
    pages: List[str]
    chunk_ids: List[str]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description='Benchmark vector vs hybrid retrieval for generation flows.'
    )
    parser.add_argument('--user-storage-id', required=True)
    parser.add_argument(
        '--generation-type',
        choices=['quiz', 'flashcard'],
        default='quiz',
    )
    parser.add_argument('--requested-items', type=int, default=10)
    parser.add_argument('--keyword', help='Optional keyword for narrow search benchmark.')
    parser.add_argument('--model-type', default='gemini')
    parser.add_argument('--max-chunks', type=int, default=8)
    parser.add_argument('--output', help='Optional JSON output path.')
    return parser.parse_args()


async def benchmark_generation_mode(
    *,
    user_storage_id: str,
    generation_type: str,
    requested_items: int,
    keyword: Optional[str],
    model_type: str,
    max_chunks: int,
    mode: str,
) -> GenerationBenchmarkRow:
    previous_mode = os.environ.get('AI_RETRIEVAL_MODE')
    os.environ['AI_RETRIEVAL_MODE'] = mode

    try:
        start = time.perf_counter()
        result: RetrievalResult = await hybrid_retrieval_service.retrieve_for_generation(
            user_storage_id=user_storage_id,
            total_items=requested_items,
            model_type=model_type,
            keyword=keyword,
            is_narrow_search=bool(keyword),
            max_chunks=max_chunks,
        )
        elapsed_ms = int((time.perf_counter() - start) * 1000)

        all_chunks = await ocr_service.get_document_chunks(user_storage_id)
        graph_entry = await hybrid_retrieval_service._get_or_build_graph_entry(  # noqa: SLF001
            user_storage_id,
            all_chunks,
        )
        generation_groups = hybrid_retrieval_service.plan_generation_groups(
            user_storage_id=user_storage_id,
            selected_chunks=result.chunks,
            total_items=requested_items,
            graph_entry=graph_entry,
            seed_chunks=None,
            keyword=keyword,
        )

        distribution = generation_service._allocate_items_to_groups(  # noqa: SLF001
            requested_items,
            generation_groups,
        )
        return GenerationBenchmarkRow(
            mode=mode,
            generation_type=generation_type,
            requested_items=requested_items,
            keyword=keyword,
            elapsed_ms=elapsed_ms,
            selected_chunks=result.metadata.get('selected_chunks', len(result.chunks)),
            total_chunks=result.metadata.get('total_chunks', 0),
            seed_chunks=result.metadata.get('seed_chunks', 0),
            distribution=distribution,
            pages=[chunk.page_range for chunk in result.chunks],
            chunk_ids=[chunk.id for chunk in result.chunks],
        )
    finally:
        hybrid_retrieval_service.clear_graph_cache(user_storage_id)
        if previous_mode is None:
            os.environ.pop('AI_RETRIEVAL_MODE', None)
        else:
            os.environ['AI_RETRIEVAL_MODE'] = previous_mode


def print_summary(rows: List[GenerationBenchmarkRow]) -> None:
    print('\n=== Generation Retrieval Benchmark Summary ===')
    for row in rows:
        print(
            f"- mode={row.mode:<6} type={row.generation_type:<9} elapsed_ms={row.elapsed_ms} "
            f"selected={row.selected_chunks}/{row.total_chunks} seed={row.seed_chunks} "
            f"distribution={row.distribution} keyword={row.keyword!r}"
        )
        print(f"  pages={row.pages}")
        print(f"  chunk_ids={row.chunk_ids}")


async def main() -> int:
    args = parse_args()

    file_info = await ocr_service.get_file_info(args.user_storage_id)
    if not file_info:
        print(f"UserStorage không tồn tại: {args.user_storage_id}")
        return 1

    chunks = await ocr_service.get_document_chunks(args.user_storage_id)
    if not chunks:
        print(
            f"UserStorage {args.user_storage_id} chưa có chunks. Hãy OCR/process file trước khi benchmark."
        )
        return 1

    rows = []
    for mode in ('vector', 'hybrid'):
        rows.append(
            await benchmark_generation_mode(
                user_storage_id=args.user_storage_id,
                generation_type=args.generation_type,
                requested_items=args.requested_items,
                keyword=args.keyword,
                model_type=args.model_type,
                max_chunks=args.max_chunks,
                mode=mode,
            )
        )

    print_summary(rows)

    payload = {
        'user_storage_id': args.user_storage_id,
        'filename': file_info.filename,
        'generation_type': args.generation_type,
        'requested_items': args.requested_items,
        'keyword': args.keyword,
        'model_type': args.model_type,
        'results': [asdict(row) for row in rows],
    }

    if args.output:
        output_path = Path(args.output).resolve()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding='utf-8',
        )
        print(f"\nĐã ghi kết quả benchmark generation vào: {output_path}")
    else:
        print('\n=== JSON Result ===')
        print(json.dumps(payload, ensure_ascii=False, indent=2))

    return 0


if __name__ == '__main__':
    raise SystemExit(asyncio.run(main()))
