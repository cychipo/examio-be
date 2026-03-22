"""Lightweight integration-style checks for the HybridRetrievalService."""

from __future__ import annotations

import asyncio
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

CURRENT_FILE = Path(__file__).resolve()
PROJECT_ROOT = CURRENT_FILE.parents[3]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.append(str(PROJECT_ROOT))

import src.backend.services.hybrid_retrieval_service as hybrid_module  # noqa: E402
import src.backend.services.graph_storage_service as graph_storage_module  # noqa: E402
from src.backend.services.hybrid_retrieval_service import (  # noqa: E402
    GraphCacheEntry,
    GenerationGroup,
    HybridRetrievalService,
)
from src.backend.services.generation_service import ContentGenerationService  # noqa: E402
from src.backend.services.ocr_service import DocumentChunk  # noqa: E402


def make_chunks() -> list[DocumentChunk]:
    now = datetime.utcnow()
    return [
        DocumentChunk(
            id='chunk-1',
            user_storage_id='user-storage-1',
            page_range='1-2',
            title='Khái niệm',
            content='Định nghĩa kiến trúc hệ thống và các thành phần chính.',
            created_at=now,
        ),
        DocumentChunk(
            id='chunk-2',
            user_storage_id='user-storage-1',
            page_range='3-4',
            title='Ví dụ',
            content='Ví dụ triển khai hệ thống với kiến trúc phân lớp.',
            created_at=now + timedelta(seconds=1),
        ),
        DocumentChunk(
            id='chunk-3',
            user_storage_id='user-storage-1',
            page_range='5-6',
            title='Ứng dụng',
            content='Ứng dụng thực tế, ưu điểm và hạn chế của kiến trúc.',
            created_at=now + timedelta(seconds=2),
        ),
    ]


def test_graph_persistence_roundtrip() -> None:
    service = HybridRetrievalService()
    user_storage_id = 'hybrid-test-artifact'
    chunks = make_chunks()
    original_builder = service._build_graph_cache_entry
    original_persist = graph_storage_module.graph_storage_service.persist_graph_state
    original_load = graph_storage_module.graph_storage_service.load_graph_state

    async def fake_build_graph_cache_entry(user_storage_id: str, chunks: list[DocumentChunk]):
        import networkx as nx

        graph = nx.Graph()
        chunk_to_node = {}
        node_to_chunk = {}
        for index, chunk in enumerate(chunks):
            graph.add_node(index, content=chunk.content, metadata={'chunk_id': chunk.id})
            chunk_to_node[chunk.id] = index
            node_to_chunk[index] = chunk
            if index > 0:
                graph.add_edge(index - 1, index, edge_type='structural', weight=1.0)

        partitioner = hybrid_module.SubgraphPartitioner(graph)
        partitioner.subgraphs = {0: set(range(len(chunks)))}
        for node_id in graph.nodes:
            graph.nodes[node_id]['community'] = 0

        entry = GraphCacheEntry(
            signature=service._signature_for_chunks(chunks),  # noqa: SLF001
            graph=graph,
            partitioner=partitioner,
            chunk_to_node=chunk_to_node,
            node_to_chunk=node_to_chunk,
            generation_groups=[
                GenerationGroup(
                    group_index=0,
                    chunks=chunks,
                    community_id=0,
                    page_ranges=[chunk.page_range for chunk in chunks],
                    page_start=1,
                    page_end=6,
                    estimated_tokens=120,
                    char_count=sum(len(chunk.content) for chunk in chunks),
                    weight=120,
                    summary=None,
                    metadata={'chunk_count': len(chunks)},
                )
            ],
        )
        service._graph_cache[user_storage_id] = entry  # noqa: SLF001
        return entry

    service.clear_graph_state(user_storage_id)
    try:
        persisted_payload = {}

        async def fake_persist_graph_state(user_storage_id: str, **kwargs):
            persisted_payload['state'] = kwargs

        async def fake_load_graph_state(user_storage_id: str):
            assert user_storage_id == 'hybrid-test-artifact'
            state = persisted_payload.get('state')
            if state is None:
                return None
            return {
                'graph_id': 'graph-1',
                'graph_version': state['graph_version'],
                'chunk_signature': state['chunk_signature'],
                'status': 'READY',
                'total_chunks': state['total_chunks'],
                'total_edges': state['total_edges'],
                'total_communities': state['total_communities'],
                'total_groups': len(state['groups']),
                'metadata': state['metadata'],
                'built_at': datetime.utcnow(),
                'updated_at': datetime.utcnow(),
                'groups': [
                    {
                        'groupIndex': group.group_index,
                        'communityId': group.community_id,
                        'pageStart': group.page_start,
                        'pageEnd': group.page_end,
                        'pageRanges': group.page_ranges,
                        'chunkIds': group.chunk_ids,
                        'estimatedTokens': group.estimated_tokens,
                        'charCount': group.char_count,
                        'weight': group.weight,
                        'metadata': group.metadata,
                    }
                    for group in state['groups']
                ],
            }

        graph_storage_module.graph_storage_service.persist_graph_state = fake_persist_graph_state
        graph_storage_module.graph_storage_service.load_graph_state = fake_load_graph_state
        service._build_graph_cache_entry = fake_build_graph_cache_entry  # type: ignore[method-assign]
        entry = asyncio.run(
            service._build_graph_cache_entry(user_storage_id, chunks)  # noqa: SLF001
        )
        asyncio.run(
            graph_storage_module.graph_storage_service.persist_graph_state(
                user_storage_id,
                chunk_signature=service._chunk_signature_string(chunks),  # noqa: SLF001
                total_chunks=len(chunks),
                total_edges=entry.graph.number_of_edges(),
                total_communities=1,
                metadata={},
                groups=[
                    graph_storage_module.PersistedGraphGroup(
                        group_index=0,
                        community_id=0,
                        page_start=1,
                        page_end=6,
                        page_ranges=[chunk.page_range for chunk in chunks],
                        chunk_ids=[chunk.id for chunk in chunks],
                        estimated_tokens=120,
                        char_count=sum(len(chunk.content) for chunk in chunks),
                        weight=120,
                        summary=None,
                        metadata={},
                    )
                ],
                graph_version=2,
            )
        )
        assert entry.graph.number_of_nodes() == len(chunks)
        assert 'state' in persisted_payload
        assert 'metadata' in persisted_payload['state']
        assert len(persisted_payload['state']['groups']) >= 1

        service.clear_graph_cache(user_storage_id)
        loaded = asyncio.run(service._get_or_build_graph_entry(user_storage_id, chunks))  # noqa: SLF001
        assert isinstance(loaded, GraphCacheEntry)
        assert loaded is not None
        assert loaded.graph.number_of_nodes() == len(chunks)
        assert loaded.chunk_to_node['chunk-1'] == 0
    finally:
        service._build_graph_cache_entry = original_builder  # type: ignore[method-assign]
        graph_storage_module.graph_storage_service.persist_graph_state = original_persist
        graph_storage_module.graph_storage_service.load_graph_state = original_load
        service.clear_graph_state(user_storage_id)


def test_graph_stats_without_db() -> None:
    service = HybridRetrievalService()
    user_storage_id = 'hybrid-test-stats'
    chunks = make_chunks()
    original_builder = service._build_graph_cache_entry
    original_load = graph_storage_module.graph_storage_service.load_graph_state

    async def fake_build_graph_cache_entry(user_storage_id: str, chunks: list[DocumentChunk]):
        import networkx as nx

        graph = nx.Graph()
        chunk_to_node = {}
        node_to_chunk = {}
        for index, chunk in enumerate(chunks):
            graph.add_node(index, content=chunk.content, metadata={'chunk_id': chunk.id}, community=0)
            chunk_to_node[chunk.id] = index
            node_to_chunk[index] = chunk
        graph.add_edge(0, 1, edge_type='structural', weight=1.0)
        graph.add_edge(1, 2, edge_type='semantic', weight=0.9)

        partitioner = hybrid_module.SubgraphPartitioner(graph)
        partitioner.subgraphs = {0: {0, 1, 2}}
        entry = GraphCacheEntry(
            signature=service._signature_for_chunks(chunks),  # noqa: SLF001
            graph=graph,
            partitioner=partitioner,
            chunk_to_node=chunk_to_node,
            node_to_chunk=node_to_chunk,
            generation_groups=[
                GenerationGroup(
                    group_index=0,
                    chunks=chunks,
                    community_id=0,
                    page_ranges=[chunk.page_range for chunk in chunks],
                    page_start=1,
                    page_end=6,
                    estimated_tokens=100,
                    char_count=sum(len(chunk.content) for chunk in chunks),
                    weight=100,
                    summary=None,
                    metadata={'chunk_count': len(chunks)},
                )
            ],
        )
        service._graph_cache[user_storage_id] = entry  # noqa: SLF001
        return entry

    service.clear_graph_state(user_storage_id)
    original_method = hybrid_module.ocr_service.get_document_chunks

    async def fake_get_document_chunks(user_storage_id: str):
        assert user_storage_id == 'hybrid-test-stats'
        return chunks

    try:
        service._build_graph_cache_entry = fake_build_graph_cache_entry  # type: ignore[method-assign]
        _ = asyncio.run(
            service._build_graph_cache_entry(user_storage_id, chunks)  # noqa: SLF001
        )
        hybrid_module.ocr_service.get_document_chunks = fake_get_document_chunks
        async def fake_load_graph_state(user_storage_id: str):
            assert user_storage_id == 'hybrid-test-stats'
            return {
                'graph_id': 'graph-stats',
                'graph_version': 2,
                'chunk_signature': service._chunk_signature_string(chunks),  # noqa: SLF001
                'status': 'READY',
                'total_chunks': len(chunks),
                'total_edges': 2,
                'total_communities': 1,
                'total_groups': 1,
                'metadata': {},
                'built_at': datetime.utcnow(),
                'updated_at': datetime.utcnow(),
                'groups': [
                    {
                        'groupIndex': 0,
                        'communityId': 0,
                        'pageStart': 1,
                        'pageEnd': 6,
                        'pageRanges': ['1-2', '3-4', '5-6'],
                        'chunkIds': [chunk.id for chunk in chunks],
                        'estimatedTokens': 100,
                        'charCount': 400,
                        'weight': 100,
                        'metadata': {},
                    }
                ],
            }
        graph_storage_module.graph_storage_service.load_graph_state = fake_load_graph_state
        stats = asyncio.run(service.get_graph_stats(user_storage_id))
        assert stats['graph_available'] is True
        assert stats['nodes'] == len(chunks)
        assert stats['groups'] >= 1
    finally:
        service._build_graph_cache_entry = original_builder  # type: ignore[method-assign]
        graph_storage_module.graph_storage_service.load_graph_state = original_load
        hybrid_module.ocr_service.get_document_chunks = original_method
        service.clear_graph_state(user_storage_id)


def test_graph_builder_uses_bruteforce_when_faiss_disabled() -> None:
    os_value = os.environ.get('AI_GRAPH_USE_FAISS')
    os.environ['AI_GRAPH_USE_FAISS'] = 'false'

    service = HybridRetrievalService()
    user_storage_id = 'hybrid-test-no-faiss'
    chunks = make_chunks()
    original_persist = graph_storage_module.graph_storage_service.persist_graph_state

    try:
        async def fake_persist_graph_state(user_storage_id: str, **kwargs):
            return None

        graph_storage_module.graph_storage_service.persist_graph_state = fake_persist_graph_state
        entry = asyncio.run(service._build_graph_cache_entry(user_storage_id, chunks))  # noqa: SLF001
        assert entry.graph.number_of_nodes() == len(chunks)
        assert entry.graph.number_of_edges() >= len(chunks) - 1
    finally:
        graph_storage_module.graph_storage_service.persist_graph_state = original_persist
        if os_value is None:
            os.environ.pop('AI_GRAPH_USE_FAISS', None)
        else:
            os.environ['AI_GRAPH_USE_FAISS'] = os_value
        service.clear_graph_state(user_storage_id)


def test_dynamic_group_allocation_scales_with_requested_items() -> None:
    retrieval_service = HybridRetrievalService()
    generation_service = ContentGenerationService()
    chunks = make_chunks()

    groups = [
        GenerationGroup(
            group_index=0,
            chunks=[chunks[0]],
            community_id=0,
            page_ranges=[chunks[0].page_range],
            page_start=1,
            page_end=2,
            estimated_tokens=100,
            char_count=len(chunks[0].content),
            weight=100,
            summary=None,
            metadata={},
        ),
        GenerationGroup(
            group_index=1,
            chunks=[chunks[1]],
            community_id=1,
            page_ranges=[chunks[1].page_range],
            page_start=3,
            page_end=4,
            estimated_tokens=200,
            char_count=len(chunks[1].content),
            weight=200,
            summary=None,
            metadata={},
        ),
        GenerationGroup(
            group_index=2,
            chunks=[chunks[2]],
            community_id=2,
            page_ranges=[chunks[2].page_range],
            page_start=5,
            page_end=6,
            estimated_tokens=300,
            char_count=len(chunks[2].content),
            weight=300,
            summary=None,
            metadata={},
        ),
    ]

    graph_entry = GraphCacheEntry(
        signature=retrieval_service._signature_for_chunks(chunks),  # noqa: SLF001
        graph=hybrid_module.nx.Graph(),
        partitioner=hybrid_module.SubgraphPartitioner(hybrid_module.nx.Graph()),
        chunk_to_node={chunk.id: index for index, chunk in enumerate(chunks)},
        node_to_chunk={index: chunk for index, chunk in enumerate(chunks)},
        generation_groups=groups,
    )

    few_groups = retrieval_service.plan_generation_groups(
        user_storage_id='user-storage-1',
        selected_chunks=chunks,
        total_items=5,
        graph_entry=graph_entry,
        seed_chunks=None,
        keyword=None,
    )
    many_groups = retrieval_service.plan_generation_groups(
        user_storage_id='user-storage-1',
        selected_chunks=chunks,
        total_items=50,
        graph_entry=graph_entry,
        seed_chunks=None,
        keyword=None,
    )

    assert len(few_groups) <= len(many_groups)

    few_allocation = generation_service._allocate_items_to_groups(5, few_groups)  # noqa: SLF001
    many_allocation = generation_service._allocate_items_to_groups(50, many_groups)  # noqa: SLF001

    assert sum(few_allocation) == 5
    assert sum(many_allocation) == 50
    assert len(many_allocation) >= len(few_allocation)
    assert max(many_allocation) >= max(few_allocation)


def test_content_quality_score_penalizes_structural_content() -> None:
    retrieval_service = HybridRetrievalService()

    structural_text = """
Mục lục
1.1.1 Biến môi trường
Chương 1: Tổng quan
Trang 12
Section 2.1 Runtime Config
"""
    knowledge_text = """
Biến môi trường là cơ chế cung cấp cấu hình cho ứng dụng ở thời điểm chạy.
Nó giúp tách cấu hình khỏi mã nguồn, hỗ trợ triển khai linh hoạt giữa nhiều môi trường.
Ví dụ, ứng dụng có thể đọc DATABASE_URL từ môi trường để kết nối cơ sở dữ liệu.
"""

    structural_score = retrieval_service._content_quality_score(structural_text)  # noqa: SLF001
    knowledge_score = retrieval_service._content_quality_score(knowledge_text)  # noqa: SLF001
    assert knowledge_score > structural_score


def test_generation_prompt_contains_quality_gate() -> None:
    generation_service = ContentGenerationService()
    prompt = generation_service._build_generation_prompt('BASE PROMPT')  # noqa: SLF001
    assert 'QUALITY GATE' in prompt
    assert 'document navigation' in prompt


def test_generation_meta_ratio_detects_document_navigation_output() -> None:
    generation_service = ContentGenerationService()
    items = [
        {'question': 'Trong chương 1, mục nào nói về biến môi trường?'},
        {'question': 'Ở trang nào đề cập đến cấu hình runtime?'},
        {'question': 'Biến môi trường dùng để làm gì?'},
    ]
    ratio = generation_service._meta_item_ratio(items)  # noqa: SLF001
    assert ratio > 0.34


def test_retry_prompt_is_stricter_than_base_prompt() -> None:
    generation_service = ContentGenerationService()
    base = generation_service._build_generation_prompt('BASE PROMPT')  # noqa: SLF001
    retry = generation_service._build_retry_generation_prompt('BASE PROMPT')  # noqa: SLF001
    assert len(retry) > len(base)
    assert 'RETRY RULES' in retry
    assert 'BAD examples' in retry


if __name__ == '__main__':
    test_graph_persistence_roundtrip()
    test_graph_stats_without_db()
    test_graph_builder_uses_bruteforce_when_faiss_disabled()
    test_dynamic_group_allocation_scales_with_requested_items()
    test_content_quality_score_penalizes_structural_content()
    test_generation_prompt_contains_quality_gate()
    test_generation_meta_ratio_detects_document_navigation_output()
    test_retry_prompt_is_stricter_than_base_prompt()
    print('Hybrid retrieval integration checks passed.')
