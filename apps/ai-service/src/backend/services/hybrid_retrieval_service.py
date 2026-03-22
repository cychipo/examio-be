import logging
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, List, Optional

import networkx as nx
from langchain_core.documents import Document

from src.backend.services.graph_storage_service import (
    PersistedGraphGroup,
    graph_storage_service,
)
from src.backend.services.ocr_service import DocumentChunk, ocr_service
from src.graph_rag.graph_builder import DocumentGraph
from src.graph_rag.subgraph_partitioner import SubgraphPartitioner
from src.rag.vector_store_pg import get_pg_vector_store

logger = logging.getLogger(__name__)


@dataclass
class RetrievalResult:
    chunks: List[DocumentChunk]
    combined_context: Optional[str]
    sources: List[Dict[str, Any]]
    retrieval_mode: str
    metadata: Dict[str, Any]


@dataclass
class GenerationGroup:
    group_index: int
    chunks: List[DocumentChunk]
    community_id: Optional[int]
    page_ranges: List[str]
    page_start: Optional[int]
    page_end: Optional[int]
    estimated_tokens: int
    char_count: int
    weight: float
    summary: Optional[str]
    metadata: Dict[str, Any]


@dataclass
class GraphCacheEntry:
    signature: tuple[str, ...]
    graph: nx.Graph
    partitioner: SubgraphPartitioner
    chunk_to_node: Dict[str, int]
    node_to_chunk: Dict[int, DocumentChunk]
    generation_groups: List[GenerationGroup]
    persisted_graph_id: Optional[str] = None


class HybridRetrievalService:
    DEFAULT_RETRIEVAL_MODE = 'hybrid'
    DEFAULT_CHAT_TOP_K = 8
    DEFAULT_GENERATION_TOP_K = 24
    DEFAULT_CHAT_MAX_CONTENT_LENGTH = 8000
    DEFAULT_HOP_DEPTH = 1
    GRAPH_VERSION = 2
    TARGET_GROUP_CHAR_SIZE = 5000
    MIN_GROUP_CHAR_SIZE = 1800

    def __init__(self) -> None:
        self._graph_cache: Dict[str, GraphCacheEntry] = {}

    def _resolve_mode(self) -> str:
        import os

        mode = os.getenv('AI_RETRIEVAL_MODE', self.DEFAULT_RETRIEVAL_MODE)
        normalized = mode.strip().lower()
        if normalized not in {'vector', 'graph', 'hybrid'}:
            logger.warning(
                f"Invalid AI_RETRIEVAL_MODE={mode!r}, using default={self.DEFAULT_RETRIEVAL_MODE}"
            )
            return self.DEFAULT_RETRIEVAL_MODE
        return normalized

    def _signature_for_chunks(self, chunks: List[DocumentChunk]) -> tuple[str, ...]:
        return tuple(
            f"{chunk.id}:{chunk.created_at.isoformat()}" for chunk in chunks
        )

    def _chunk_signature_string(self, chunks: List[DocumentChunk]) -> str:
        return '|'.join(self._signature_for_chunks(chunks))

    def _to_langchain_documents(self, chunks: List[DocumentChunk]) -> List[Document]:
        return [
            Document(
                page_content=chunk.content,
                metadata={
                    'source': chunk.user_storage_id,
                    'chunk_id': chunk.id,
                    'chunk_index': index,
                    'page_range': chunk.page_range,
                    'title': chunk.title or f'Chunk {index + 1}',
                },
            )
            for index, chunk in enumerate(chunks)
        ]

    def _resolve_chunk_created_at(self, value: Optional[datetime]) -> datetime:
        if value is not None:
            return value
        return datetime.utcnow()

    def _page_key(self, page_range: str) -> int:
        try:
            return int(str(page_range).split('-')[0])
        except Exception:
            return 0

    def _estimated_tokens(self, text: str) -> int:
        return max(1, len(text) // 4)

    def _content_quality_score(self, text: str) -> float:
        normalized = text.strip()
        if not normalized:
            return 0.1

        lines = [line.strip() for line in normalized.splitlines() if line.strip()]
        if not lines:
            return 0.1

        structural_line_count = 0
        rich_line_count = 0
        keyword_hits = 0

        knowledge_patterns = [
            r'khái niệm',
            r'định nghĩa',
            r'nguyên lý',
            r'cơ chế',
            r'ví dụ',
            r'ứng dụng',
            r'công thức',
            r'quy trình',
            r'lợi ích',
            r'hạn chế',
            r'mục tiêu',
            r'nguyên nhân',
            r'kết quả',
            r'so sánh',
            r'điều kiện',
        ]
        structural_patterns = [
            r'^mục\s+\d+(?:\.\d+)*',
            r'^chương\s+\d+(?:\.\d+)*',
            r'^phần\s+\d+(?:\.\d+)*',
            r'^section\s+\d+(?:\.\d+)*',
            r'^chapter\s+\d+(?:\.\d+)*',
            r'^table of contents',
            r'^mục lục',
            r'^trang\s+\d+$',
            r'^page\s+\d+$',
            r'^\d+(?:\.\d+){1,6}\s+\S+',
        ]

        for line in lines:
            lowered = line.lower()
            if any(re.search(pattern, lowered) for pattern in structural_patterns):
                structural_line_count += 1
            if len(line) >= 40:
                rich_line_count += 1
            keyword_hits += sum(1 for pattern in knowledge_patterns if re.search(pattern, lowered))

        density_score = min(len(normalized) / 1200.0, 4.0)
        rich_ratio = rich_line_count / max(1, len(lines))
        structural_ratio = structural_line_count / max(1, len(lines))
        keyword_score = min(keyword_hits * 0.35, 3.0)

        score = 1.0 + density_score + rich_ratio * 2.5 + keyword_score - structural_ratio * 2.8
        return max(0.2, score)

    def _group_content_quality_score(self, chunks: List[DocumentChunk]) -> float:
        if not chunks:
            return 0.1
        combined_text = '\n'.join(chunk.content for chunk in chunks)
        return self._content_quality_score(combined_text)

    def _score_edge(self, edge_data: Dict[str, Any], depth: int) -> float:
        weight = float(edge_data.get('weight', 0.5))
        edge_type = edge_data.get('edge_type', '')
        type_bonus = 1.0
        if edge_type == 'structural':
            type_bonus = 1.15
        elif str(edge_type).startswith('metadata'):
            type_bonus = 1.05
        elif edge_type == 'semantic':
            type_bonus = 1.25
        return (weight * type_bonus) / max(1, depth)

    async def _vector_seed_chunks(
        self,
        user_storage_id: str,
        query: str,
        top_k: int,
        model_type: str,
    ) -> List[DocumentChunk]:
        if not query.strip():
            return []

        vector_store = get_pg_vector_store()
        similar_docs = await vector_store.search_similar(
            [user_storage_id],
            query,
            top_k=top_k,
            similarity_threshold=0.5,
            model_type=model_type,
        )
        return [
            DocumentChunk(
                id=doc.id,
                user_storage_id=doc.user_storage_id,
                page_range=doc.page_range,
                title=doc.title,
                content=doc.content,
                created_at=self._resolve_chunk_created_at(doc.created_at),
            )
            for doc in similar_docs
        ]

    def _build_generation_groups(
        self,
        chunks: List[DocumentChunk],
        graph_entry: Optional[GraphCacheEntry],
    ) -> List[GenerationGroup]:
        if not chunks:
            return []

        community_to_chunks: Dict[int, List[DocumentChunk]] = {}
        if graph_entry is not None:
            for chunk in chunks:
                node_id = graph_entry.chunk_to_node.get(chunk.id)
                if node_id is None:
                    continue
                community_id = graph_entry.graph.nodes[node_id].get('community')
                if community_id is None:
                    continue
                community_to_chunks.setdefault(int(community_id), []).append(chunk)

        ordered_groups = sorted(
            community_to_chunks.items(),
            key=lambda item: min(self._page_key(chunk.page_range) for chunk in item[1]),
        )
        remaining_chunks = [
            chunk for chunk in chunks if chunk.id not in {
                grouped_chunk.id
                for grouped_chunks in community_to_chunks.values()
                for grouped_chunk in grouped_chunks
            }
        ]
        for chunk in remaining_chunks:
            ordered_groups.append((-1, [chunk]))

        groups: List[GenerationGroup] = []
        group_index = 0
        for community_id, community_chunks in ordered_groups:
            sorted_chunks = sorted(community_chunks, key=lambda chunk: self._page_key(chunk.page_range))
            current_batch: List[DocumentChunk] = []
            current_chars = 0

            for chunk in sorted_chunks:
                chunk_chars = len(chunk.content)
                if current_batch and current_chars + chunk_chars > self.TARGET_GROUP_CHAR_SIZE:
                    groups.append(
                        self._make_group(
                            group_index=group_index,
                            chunks=current_batch,
                            community_id=community_id if community_id >= 0 else None,
                        )
                    )
                    group_index += 1
                    current_batch = []
                    current_chars = 0

                current_batch.append(chunk)
                current_chars += chunk_chars

            if current_batch:
                groups.append(
                    self._make_group(
                        group_index=group_index,
                        chunks=current_batch,
                        community_id=community_id if community_id >= 0 else None,
                    )
                )
                group_index += 1

        if len(groups) > 1:
            merged_groups: List[GenerationGroup] = []
            index = 0
            while index < len(groups):
                group = groups[index]
                if (
                    group.char_count < self.MIN_GROUP_CHAR_SIZE
                    and index + 1 < len(groups)
                    and groups[index + 1].char_count < self.TARGET_GROUP_CHAR_SIZE
                ):
                    merged_groups.append(
                        self._make_group(
                            group_index=len(merged_groups),
                            chunks=group.chunks + groups[index + 1].chunks,
                            community_id=group.community_id,
                        )
                    )
                    index += 2
                    continue

                merged_groups.append(
                    self._make_group(
                        group_index=len(merged_groups),
                        chunks=group.chunks,
                        community_id=group.community_id,
                    )
                )
                index += 1
            groups = merged_groups

        return groups

    def _make_group(
        self,
        *,
        group_index: int,
        chunks: List[DocumentChunk],
        community_id: Optional[int],
    ) -> GenerationGroup:
        page_ranges = [chunk.page_range for chunk in chunks]
        page_values = [self._page_key(page_range) for page_range in page_ranges if page_range]
        char_count = sum(len(chunk.content) for chunk in chunks)
        estimated_tokens = sum(self._estimated_tokens(chunk.content) for chunk in chunks)
        content_quality_score = self._group_content_quality_score(chunks)
        return GenerationGroup(
            group_index=group_index,
            chunks=chunks,
            community_id=community_id,
            page_ranges=page_ranges,
            page_start=min(page_values) if page_values else None,
            page_end=max(page_values) if page_values else None,
            estimated_tokens=estimated_tokens,
            char_count=char_count,
            weight=max(1.0, float(estimated_tokens)) * content_quality_score,
            summary=None,
            metadata={
                'chunk_count': len(chunks),
                'content_quality_score': content_quality_score,
            },
        )

    async def _persist_groups_to_db(
        self,
        user_storage_id: str,
        chunks: List[DocumentChunk],
        entry: GraphCacheEntry,
    ) -> None:
        await graph_storage_service.persist_graph_state(
            user_storage_id,
            chunk_signature=self._chunk_signature_string(chunks),
            total_chunks=len(chunks),
            total_edges=entry.graph.number_of_edges(),
            total_communities=len(entry.partitioner.subgraphs),
            metadata={
                'graph_mode': 'hybrid',
            },
            groups=[
                PersistedGraphGroup(
                    group_index=group.group_index,
                    community_id=group.community_id,
                    page_start=group.page_start,
                    page_end=group.page_end,
                    page_ranges=group.page_ranges,
                    chunk_ids=[chunk.id for chunk in group.chunks],
                    estimated_tokens=group.estimated_tokens,
                    char_count=group.char_count,
                    weight=group.weight,
                    summary=group.summary,
                    metadata=group.metadata,
                )
                for group in entry.generation_groups
            ],
            graph_version=self.GRAPH_VERSION,
        )

    async def _load_graph_state_from_db(
        self,
        user_storage_id: str,
        chunks: List[DocumentChunk],
    ) -> Optional[GraphCacheEntry]:
        state = await graph_storage_service.load_graph_state(user_storage_id)
        if state is None:
            return None

        if state['chunk_signature'] != self._chunk_signature_string(chunks):
            return None

        chunk_map = {chunk.id: chunk for chunk in chunks}
        graph = nx.Graph()
        chunk_to_node: Dict[str, int] = {}
        node_to_chunk: Dict[int, DocumentChunk] = {}

        for index, chunk in enumerate(chunks):
            graph.add_node(index, chunk_id=chunk.id)
            chunk_to_node[chunk.id] = index
            node_to_chunk[index] = chunk

        partitioner = SubgraphPartitioner(graph)
        subgraphs: Dict[int, set[int]] = {}
        groups: List[GenerationGroup] = []
        for group_row in state['groups']:
            community_id = group_row.get('communityId')
            chunk_ids = [str(chunk_id) for chunk_id in (group_row.get('chunkIds') or [])]
            group_chunks = [chunk_map[chunk_id] for chunk_id in chunk_ids if chunk_id in chunk_map]
            if not group_chunks:
                continue

            if community_id is not None:
                subgraphs.setdefault(int(community_id), set()).update(
                    chunk_to_node[chunk.id] for chunk in group_chunks
                )

            groups.append(
                GenerationGroup(
                    group_index=int(group_row['groupIndex']),
                    chunks=group_chunks,
                    community_id=community_id,
                    page_ranges=[str(page) for page in (group_row.get('pageRanges') or [])],
                    page_start=group_row.get('pageStart'),
                    page_end=group_row.get('pageEnd'),
                    estimated_tokens=int(group_row.get('estimatedTokens') or 0),
                    char_count=int(group_row.get('charCount') or 0),
                    weight=float(group_row.get('weight') or 1),
                    summary=group_row.get('summary'),
                    metadata=dict(group_row.get('metadata') or {}),
                )
            )

        partitioner.subgraphs = subgraphs
        return GraphCacheEntry(
            signature=self._signature_for_chunks(chunks),
            graph=graph,
            partitioner=partitioner,
            chunk_to_node=chunk_to_node,
            node_to_chunk=node_to_chunk,
            generation_groups=sorted(groups, key=lambda group: group.group_index),
            persisted_graph_id=state['graph_id'],
        )

    async def _build_graph_cache_entry(
        self, user_storage_id: str, chunks: List[DocumentChunk]
    ) -> GraphCacheEntry:
        documents = self._to_langchain_documents(chunks)
        builder = DocumentGraph()

        for index, document in enumerate(documents):
            builder.graph.add_node(
                index,
                content=document.page_content,
                metadata=document.metadata,
                document=document,
            )

        builder._add_structural_edges(documents)
        builder._add_metadata_edges(documents)
        builder._add_semantic_edges(documents)

        partitioner = SubgraphPartitioner(builder.graph)
        partitioner.partition_by_community_detection(generate_summaries=False)
        generation_groups = self._build_generation_groups(chunks, None)

        entry = GraphCacheEntry(
            signature=self._signature_for_chunks(chunks),
            graph=builder.graph,
            partitioner=partitioner,
            chunk_to_node={chunk.id: index for index, chunk in enumerate(chunks)},
            node_to_chunk={index: chunk for index, chunk in enumerate(chunks)},
            generation_groups=generation_groups,
        )
        logger.info(
            'Persisting graph groups for user_storage_id=%s groups=%s chunks=%s edges=%s communities=%s',
            user_storage_id,
            len(generation_groups),
            len(chunks),
            builder.graph.number_of_edges(),
            len(partitioner.subgraphs),
        )
        await self._persist_groups_to_db(user_storage_id, chunks, entry)
        self._graph_cache[user_storage_id] = entry
        return entry

    async def _get_or_build_graph_entry(
        self, user_storage_id: str, chunks: List[DocumentChunk]
    ) -> Optional[GraphCacheEntry]:
        if not chunks:
            return None

        signature = self._signature_for_chunks(chunks)
        cached = self._graph_cache.get(user_storage_id)
        if cached and cached.signature == signature:
            return cached

        persisted = await self._load_graph_state_from_db(user_storage_id, chunks)
        if persisted is not None:
            logger.info(
                f"Loaded persisted graph metadata from DB for user_storage_id={user_storage_id}"
            )
            self._graph_cache[user_storage_id] = persisted
            return persisted

        try:
            logger.info(
                f"Building hybrid graph cache for user_storage_id={user_storage_id} with {len(chunks)} chunks"
            )
            return await self._build_graph_cache_entry(user_storage_id, chunks)
        except Exception as error:
            logger.exception(
                'Failed to build graph cache entry for user_storage_id=%s',
                user_storage_id,
            )
            logger.warning(
                f"Failed to build graph cache for user_storage_id={user_storage_id}: {error}"
            )
            return None

    def _select_graph_connected_chunks(
        self,
        chunks: List[DocumentChunk],
        graph_entry: Optional[GraphCacheEntry],
        limit: int,
        seed_chunks: Optional[List[DocumentChunk]] = None,
    ) -> List[DocumentChunk]:
        import os

        if not chunks:
            return []

        bounded_limit = max(1, min(limit, len(chunks)))
        if len(chunks) <= bounded_limit or graph_entry is None:
            return chunks[:bounded_limit]

        scores: Dict[int, float] = {}
        selected_seed_ids: List[int] = []
        hop_depth = max(1, int(os.getenv('AI_GRAPH_HOP_DEPTH', self.DEFAULT_HOP_DEPTH)))

        if seed_chunks:
            for chunk in seed_chunks:
                node_id = graph_entry.chunk_to_node.get(chunk.id)
                if node_id is None:
                    continue
                selected_seed_ids.append(node_id)
                scores[node_id] = max(scores.get(node_id, 0.0), 100.0)
        else:
            step = len(chunks) / bounded_limit
            for index in range(bounded_limit):
                chunk_index = min(len(chunks) - 1, int(index * step))
                node_id = graph_entry.chunk_to_node.get(chunks[chunk_index].id)
                if node_id is None:
                    continue
                selected_seed_ids.append(node_id)
                scores[node_id] = max(scores.get(node_id, 0.0), 60.0 - index)

        for seed_id in selected_seed_ids:
            lengths = nx.single_source_shortest_path_length(
                graph_entry.graph, seed_id, cutoff=hop_depth
            )
            for neighbor_id, depth in lengths.items():
                if neighbor_id == seed_id:
                    continue
                edge_data = graph_entry.graph.get_edge_data(seed_id, neighbor_id)
                if edge_data is None:
                    continue
                scores[neighbor_id] = scores.get(neighbor_id, 0.0) + self._score_edge(
                    edge_data, depth
                )

        if not scores:
            return chunks[:bounded_limit]

        top_node_ids = [
            node_id
            for node_id, _ in sorted(scores.items(), key=lambda item: item[1], reverse=True)[
                :bounded_limit
            ]
        ]
        selected_chunks = [
            graph_entry.node_to_chunk[node_id]
            for node_id in sorted(top_node_ids, key=lambda node_id: node_id)
            if node_id in graph_entry.node_to_chunk
        ]
        return selected_chunks[:bounded_limit]

    def _combine_chunks_for_context(
        self, chunks: List[DocumentChunk], max_content_length: int
    ) -> Optional[str]:
        if not chunks:
            return None

        combined_content = ''
        for chunk in chunks:
            formatted_chunk = f"[Trang {chunk.page_range}]: {chunk.content}\n\n"
            if len(combined_content) + len(formatted_chunk) > max_content_length:
                break
            combined_content += formatted_chunk

        return combined_content.strip() or None

    def _build_sources(self, chunks: List[DocumentChunk]) -> List[Dict[str, Any]]:
        return [
            {
                'content': chunk.content[:300],
                'page': chunk.page_range,
                'title': chunk.title,
                'chunkId': chunk.id,
            }
            for chunk in chunks
        ]

    async def retrieve_for_chat(
        self,
        user_storage_id: str,
        query: str,
        model_type: str,
        top_k: int = DEFAULT_CHAT_TOP_K,
        max_content_length: int = DEFAULT_CHAT_MAX_CONTENT_LENGTH,
    ) -> RetrievalResult:
        chunks = await ocr_service.get_document_chunks(user_storage_id)
        if not chunks:
            return RetrievalResult([], None, [], self._resolve_mode(), {'total_chunks': 0})

        mode = self._resolve_mode()
        chunk_order = {chunk.id: index for index, chunk in enumerate(chunks)}
        seed_chunks = await self._vector_seed_chunks(
            user_storage_id=user_storage_id,
            query=query,
            top_k=min(top_k, len(chunks)),
            model_type=model_type,
        )

        selected_chunks = seed_chunks[:top_k]
        if mode in {'graph', 'hybrid'}:
            graph_entry = await self._get_or_build_graph_entry(user_storage_id, chunks)
            graph_selected = self._select_graph_connected_chunks(
                chunks=chunks,
                graph_entry=graph_entry,
                limit=top_k,
                seed_chunks=seed_chunks,
            )
            if graph_selected:
                if mode == 'graph':
                    selected_chunks = graph_selected
                else:
                    merged: Dict[str, DocumentChunk] = {}
                    for chunk in seed_chunks + graph_selected:
                        merged[chunk.id] = chunk
                    selected_chunks = sorted(
                        merged.values(), key=lambda chunk: chunk_order.get(chunk.id, len(chunks))
                    )[:top_k]

        if not selected_chunks:
            selected_chunks = chunks[:top_k]

        return RetrievalResult(
            chunks=selected_chunks,
            combined_context=self._combine_chunks_for_context(
                selected_chunks, max_content_length=max_content_length
            ),
            sources=self._build_sources(selected_chunks[:3]),
            retrieval_mode=mode,
            metadata={
                'total_chunks': len(chunks),
                'selected_chunks': len(selected_chunks),
                'seed_chunks': len(seed_chunks),
            },
        )

    async def retrieve_for_generation(
        self,
        user_storage_id: str,
        total_items: int,
        model_type: str,
        keyword: Optional[str] = None,
        is_narrow_search: bool = False,
        max_chunks: int = DEFAULT_GENERATION_TOP_K,
    ) -> RetrievalResult:
        chunks = await ocr_service.get_document_chunks(user_storage_id)
        if not chunks:
            return RetrievalResult([], None, [], self._resolve_mode(), {'total_chunks': 0})

        mode = self._resolve_mode()
        limit = max(1, min(max_chunks, max(total_items, 1) * 2, len(chunks)))
        seed_chunks: List[DocumentChunk] = []

        if is_narrow_search and keyword:
            seed_chunks = await self._vector_seed_chunks(
                user_storage_id=user_storage_id,
                query=keyword,
                top_k=min(max(limit, 6), len(chunks)),
                model_type=model_type,
            )

        graph_entry = None
        if mode in {'graph', 'hybrid'}:
            graph_entry = await self._get_or_build_graph_entry(user_storage_id, chunks)

        if seed_chunks:
            if mode in {'graph', 'hybrid'} and graph_entry is not None:
                selected_chunks = self._select_graph_connected_chunks(
                    chunks=chunks,
                    graph_entry=graph_entry,
                    limit=limit,
                    seed_chunks=seed_chunks,
                )
            else:
                selected_chunks = seed_chunks[:limit]
        else:
            if mode in {'graph', 'hybrid'} and graph_entry is not None:
                selected_chunks = self._select_graph_connected_chunks(
                    chunks=chunks,
                    graph_entry=graph_entry,
                    limit=limit,
                )
            else:
                selected_chunks = chunks[:limit]

        if not selected_chunks:
            selected_chunks = chunks[:limit]

        generation_groups = self.plan_generation_groups(
            user_storage_id=user_storage_id,
            selected_chunks=selected_chunks,
            total_items=total_items,
            graph_entry=graph_entry,
            seed_chunks=seed_chunks,
            keyword=keyword,
        )
        flattened_chunks: List[DocumentChunk] = []
        seen_chunk_ids: set[str] = set()
        for group in generation_groups:
            for chunk in group.chunks:
                if chunk.id in seen_chunk_ids:
                    continue
                seen_chunk_ids.add(chunk.id)
                flattened_chunks.append(chunk)

        return RetrievalResult(
            chunks=flattened_chunks,
            combined_context=self._combine_chunks_for_context(
                flattened_chunks,
                max_content_length=self.DEFAULT_CHAT_MAX_CONTENT_LENGTH,
            ),
            sources=self._build_sources(flattened_chunks[:3]),
            retrieval_mode=mode,
            metadata={
                'total_chunks': len(chunks),
                'selected_chunks': len(flattened_chunks),
                'seed_chunks': len(seed_chunks),
                'is_narrow_search': is_narrow_search,
                'group_count': len(generation_groups),
            },
        )

    def plan_generation_groups(
        self,
        *,
        user_storage_id: str,
        selected_chunks: List[DocumentChunk],
        total_items: int,
        graph_entry: Optional[GraphCacheEntry],
        seed_chunks: Optional[List[DocumentChunk]] = None,
        keyword: Optional[str] = None,
    ) -> List[GenerationGroup]:
        del user_storage_id
        if not selected_chunks:
            return []

        if graph_entry is None or not graph_entry.generation_groups:
            base_group = self._make_group(
                group_index=0,
                chunks=selected_chunks,
                community_id=None,
            )
            return [base_group]

        selected_chunk_ids = {chunk.id for chunk in selected_chunks}
        seed_chunk_ids = {chunk.id for chunk in (seed_chunks or [])}
        scored_groups: List[tuple[float, GenerationGroup]] = []
        for group in graph_entry.generation_groups:
            overlap = [chunk for chunk in group.chunks if chunk.id in selected_chunk_ids]
            if not overlap:
                continue

            overlap_ratio = len(overlap) / max(1, len(group.chunks))
            seed_hits = sum(1 for chunk in overlap if chunk.id in seed_chunk_ids)
            relevance_score = overlap_ratio * 4 + seed_hits * 2
            quality_score = float(group.metadata.get('content_quality_score', 1.0))
            size_bonus = min(group.weight / 2500.0, 2.0)
            quality_bonus = min(quality_score, 4.0)
            scored_groups.append(
                (
                    relevance_score + size_bonus + quality_bonus,
                    self._make_group(
                        group_index=group.group_index,
                        chunks=overlap,
                        community_id=group.community_id,
                    ),
                )
            )

        if not scored_groups:
            return [
                self._make_group(
                    group_index=0,
                    chunks=selected_chunks,
                    community_id=None,
                )
            ]

        scored_groups.sort(key=lambda item: item[0], reverse=True)
        if total_items <= 6:
            active_group_count = min(2, len(scored_groups))
        elif total_items <= 12:
            active_group_count = min(4, len(scored_groups))
        elif total_items <= 24:
            active_group_count = min(6, len(scored_groups))
        else:
            active_group_count = len(scored_groups)

        del keyword
        active_groups = [group for _, group in scored_groups[:active_group_count]]
        return sorted(active_groups, key=lambda group: group.group_index)

    def clear_graph_cache(self, user_storage_id: str) -> None:
        self._graph_cache.pop(user_storage_id, None)

    def clear_graph_artifact(self, user_storage_id: str) -> None:
        del user_storage_id

    def clear_all_graph_cache(self) -> None:
        self._graph_cache.clear()

    def clear_graph_state(self, user_storage_id: str) -> None:
        self.clear_graph_cache(user_storage_id)

    def get_graph_artifact_path(self, user_storage_id: str):
        del user_storage_id
        return None

    async def get_graph_stats(self, user_storage_id: str) -> Dict[str, Any]:
        chunks = await ocr_service.get_document_chunks(user_storage_id)
        state = await graph_storage_service.load_graph_state(user_storage_id)
        in_memory = user_storage_id in self._graph_cache

        if not chunks:
            return {
                'user_storage_id': user_storage_id,
                'total_chunks': 0,
                'graph_available': state is not None,
                'graph_in_memory': in_memory,
                'artifact_exists': False,
                'artifact_path': None,
            }

        entry = await self._get_or_build_graph_entry(user_storage_id, chunks)
        if entry is None:
            return {
                'user_storage_id': user_storage_id,
                'total_chunks': len(chunks),
                'graph_available': False,
                'graph_in_memory': in_memory,
                'artifact_exists': False,
                'artifact_path': None,
            }

        community_sizes = sorted(
            (len(node_ids) for node_ids in entry.partitioner.subgraphs.values()),
            reverse=True,
        )
        return {
            'user_storage_id': user_storage_id,
            'total_chunks': len(chunks),
            'graph_available': True,
            'graph_in_memory': in_memory,
            'artifact_exists': False,
            'artifact_path': None,
            'nodes': entry.graph.number_of_nodes(),
            'edges': entry.graph.number_of_edges(),
            'communities': len(entry.partitioner.subgraphs),
            'largest_communities': community_sizes[:5],
            'signature_size': len(entry.signature),
            'groups': len(entry.generation_groups),
        }


hybrid_retrieval_service = HybridRetrievalService()
