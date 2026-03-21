"""Benchmark script for vector vs hybrid retrieval on uploaded documents.

Usage example:
    ./venv/bin/python src/backend/scripts/benchmark_hybrid_retrieval.py \
        --user-storage-id abc123 \
        --query "Tóm tắt chương 1" \
        --query "Các khái niệm chính là gì?"
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
from typing import Any, Dict, List

# Ensure `src` is importable when running the script directly.
CURRENT_FILE = Path(__file__).resolve()
PROJECT_ROOT = CURRENT_FILE.parents[3]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.append(str(PROJECT_ROOT))

from src.backend.services.hybrid_retrieval_service import (  # noqa: E402
    RetrievalResult,
    hybrid_retrieval_service,
)
from src.backend.services.ocr_service import ocr_service  # noqa: E402


@dataclass
class RetrievalBenchmarkRow:
    mode: str
    query: str
    elapsed_ms: int
    selected_chunks: int
    total_chunks: int
    seed_chunks: int
    context_length: int
    pages: List[str]
    chunk_ids: List[str]
    sources: List[Dict[str, Any]]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description='Benchmark vector vs hybrid retrieval for one uploaded file.'
    )
    parser.add_argument(
        '--user-storage-id',
        required=True,
        help='UserStorage ID of the uploaded file to benchmark.',
    )
    parser.add_argument(
        '--query',
        action='append',
        required=True,
        help='Query to benchmark. Repeat this flag to pass multiple queries.',
    )
    parser.add_argument(
        '--model-type',
        default='gemini',
        help='Model type used for embedding/query compatibility. Default: gemini.',
    )
    parser.add_argument(
        '--top-k',
        type=int,
        default=8,
        help='Maximum number of chunks to retrieve. Default: 8.',
    )
    parser.add_argument(
        '--max-content-length',
        type=int,
        default=8000,
        help='Maximum combined context length. Default: 8000.',
    )
    parser.add_argument(
        '--output',
        help='Optional path to write the benchmark result as JSON.',
    )
    return parser.parse_args()


async def benchmark_mode(
    *,
    user_storage_id: str,
    query: str,
    model_type: str,
    mode: str,
    top_k: int,
    max_content_length: int,
) -> RetrievalBenchmarkRow:
    previous_mode = os.environ.get('AI_RETRIEVAL_MODE')
    os.environ['AI_RETRIEVAL_MODE'] = mode

    try:
        start = time.perf_counter()
        result: RetrievalResult = await hybrid_retrieval_service.retrieve_for_chat(
            user_storage_id=user_storage_id,
            query=query,
            model_type=model_type,
            top_k=top_k,
            max_content_length=max_content_length,
        )
        elapsed_ms = int((time.perf_counter() - start) * 1000)

        return RetrievalBenchmarkRow(
            mode=mode,
            query=query,
            elapsed_ms=elapsed_ms,
            selected_chunks=result.metadata.get('selected_chunks', len(result.chunks)),
            total_chunks=result.metadata.get('total_chunks', 0),
            seed_chunks=result.metadata.get('seed_chunks', 0),
            context_length=len(result.combined_context or ''),
            pages=[chunk.page_range for chunk in result.chunks],
            chunk_ids=[chunk.id for chunk in result.chunks],
            sources=result.sources,
        )
    finally:
        hybrid_retrieval_service.clear_graph_cache(user_storage_id)
        if previous_mode is None:
            os.environ.pop('AI_RETRIEVAL_MODE', None)
        else:
            os.environ['AI_RETRIEVAL_MODE'] = previous_mode


def print_summary(rows: List[RetrievalBenchmarkRow]) -> None:
    print('\n=== Retrieval Benchmark Summary ===')
    for row in rows:
        print(
            f"- mode={row.mode:<6} query={row.query!r} elapsed_ms={row.elapsed_ms} "
            f"selected={row.selected_chunks}/{row.total_chunks} seed={row.seed_chunks} "
            f"context_length={row.context_length}"
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

    all_rows: List[RetrievalBenchmarkRow] = []
    for query in args.query:
        vector_row = await benchmark_mode(
            user_storage_id=args.user_storage_id,
            query=query,
            model_type=args.model_type,
            mode='vector',
            top_k=args.top_k,
            max_content_length=args.max_content_length,
        )
        hybrid_row = await benchmark_mode(
            user_storage_id=args.user_storage_id,
            query=query,
            model_type=args.model_type,
            mode='hybrid',
            top_k=args.top_k,
            max_content_length=args.max_content_length,
        )
        all_rows.extend([vector_row, hybrid_row])

    print_summary(all_rows)

    result_payload = {
        'user_storage_id': args.user_storage_id,
        'filename': file_info.filename,
        'model_type': args.model_type,
        'top_k': args.top_k,
        'max_content_length': args.max_content_length,
        'results': [asdict(row) for row in all_rows],
    }

    if args.output:
        output_path = Path(args.output).resolve()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(
            json.dumps(result_payload, ensure_ascii=False, indent=2),
            encoding='utf-8',
        )
        print(f"\nĐã ghi kết quả benchmark vào: {output_path}")
    else:
        print('\n=== JSON Result ===')
        print(json.dumps(result_payload, ensure_ascii=False, indent=2))

    return 0


if __name__ == '__main__':
    raise SystemExit(asyncio.run(main()))
