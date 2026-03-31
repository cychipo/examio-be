"""Graph extraction helpers for tutor knowledge files."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

from src.genai_tutor.code_analyzer.common_analyzer import (
    ExtractedEntity,
    ExtractedRelation,
    extract_code_graph,
)


@dataclass
class GraphExtractionResult:
    entities: list[ExtractedEntity]
    relations: list[ExtractedRelation]


_STOPWORDS = {
    'va',
    'voi',
    'mot',
    'nhung',
    'cac',
    'cho',
    'cua',
    'the',
    'this',
    'that',
    'with',
    'from',
    'into',
    'json',
    'data',
    'file',
    'dataset',
    'pdf',
}


def extract_knowledge_graph(
    *,
    content: str,
    content_type: str,
    language: str | None,
    metadata: dict[str, Any] | None = None,
) -> GraphExtractionResult:
    metadata = metadata or {}
    normalized_language = (language or '').lower()
    if content_type == 'code' or normalized_language in {'python', 'c'}:
        entities, relations = extract_code_graph(content, normalized_language)
        return GraphExtractionResult(entities=entities, relations=relations)

    if metadata.get('sourceType') == 'json':
        return _extract_json_graph(content)

    return _extract_text_graph(content)


def _extract_json_graph(content: str) -> GraphExtractionResult:
    try:
        payload = json.loads(content)
    except json.JSONDecodeError:
        return _extract_text_graph(content)

    entities: list[ExtractedEntity] = []
    relations: list[ExtractedRelation] = []
    seen_entities: set[tuple[str, str]] = set()
    seen_relations: set[tuple[str, str, str]] = set()

    def add_entity(entity_type: str, name: str, properties: dict[str, Any]) -> None:
        canonical_name = _canonicalize(name)
        if not canonical_name:
            return
        key = (entity_type, canonical_name)
        if key in seen_entities:
            return
        seen_entities.add(key)
        entities.append(
            ExtractedEntity(
                entity_type=entity_type,
                name=name.strip(),
                canonical_name=canonical_name,
                language='json',
                properties=properties,
            )
        )

    def add_relation(relation_type: str, from_name: str, to_name: str, weight: float = 1.0) -> None:
        from_canonical = _canonicalize(from_name)
        to_canonical = _canonicalize(to_name)
        if not from_canonical or not to_canonical or from_canonical == to_canonical:
            return
        key = (relation_type, from_canonical, to_canonical)
        if key in seen_relations:
            return
        seen_relations.add(key)
        relations.append(
            ExtractedRelation(
                relation_type=relation_type,
                from_name=from_canonical,
                to_name=to_canonical,
                weight=weight,
            )
        )

    dataset_type = payload.get('datasetType') if isinstance(payload, dict) else None

    if dataset_type == 'concept_map':
        _augment_concept_map(payload, add_entity, add_relation)

    if dataset_type == 'qa_pairs':
        _augment_qa_pairs(payload, add_entity, add_relation)

    def walk(node: Any, parent_name: str | None = None, relation_hint: str | None = None) -> None:
        if isinstance(node, dict):
            node_name = _pick_object_name(node)
            if node_name:
                add_entity('KnowledgeNode', node_name, {'kind': 'json-object'})
                if parent_name and relation_hint:
                    add_relation(relation_hint, parent_name, node_name)
                parent_name = node_name

            for key, value in node.items():
                normalized_key = _canonicalize(key)
                if isinstance(value, (str, int, float, bool)):
                    if _is_meaningful_scalar(value):
                        scalar_name = str(value).strip()
                        add_entity(
                            'KnowledgeValue',
                            scalar_name,
                            {'field': key, 'kind': 'json-scalar'},
                        )
                        if parent_name:
                            add_relation(f'has_{normalized_key or "field"}', parent_name, scalar_name, 0.9)
                elif isinstance(value, list):
                    for item in value:
                        walk(item, parent_name, _relation_from_key(key))
                else:
                    walk(value, parent_name, _relation_from_key(key))
        elif isinstance(node, list):
            previous_name: str | None = None
            for item in node:
                current_name = _pick_object_name(item) if isinstance(item, dict) else str(item)
                walk(item, parent_name, relation_hint or 'contains')
                current_canonical = _canonicalize(current_name)
                if previous_name and current_canonical:
                    add_relation('related_to', previous_name, current_canonical, 0.4)
                if current_canonical:
                    previous_name = current_canonical
        elif _is_meaningful_scalar(node):
            scalar_name = str(node).strip()
            add_entity('KnowledgeValue', scalar_name, {'kind': 'json-scalar'})
            if parent_name and relation_hint:
                add_relation(relation_hint, parent_name, scalar_name, 0.7)

    walk(payload)
    return GraphExtractionResult(entities=entities, relations=relations)


def _extract_text_graph(content: str) -> GraphExtractionResult:
    lines = [line.strip() for line in content.splitlines() if line.strip()]
    entities: dict[str, ExtractedEntity] = {}
    relations: dict[tuple[str, str, str], ExtractedRelation] = {}

    for line in lines[:200]:
        for phrase in _candidate_phrases(line):
            canonical_name = _canonicalize(phrase)
            if not canonical_name:
                continue
            entities.setdefault(
                canonical_name,
                ExtractedEntity(
                    entity_type='Concept',
                    name=phrase,
                    canonical_name=canonical_name,
                    language='text',
                    properties={'kind': 'phrase'},
                ),
            )

        line_entities = [entity for entity in entities.values() if entity.name in line or entity.canonical_name in _canonicalize(line)]
        if len(line_entities) >= 2:
            anchor = line_entities[0]
            for related in line_entities[1:4]:
                key = ('related_to', anchor.canonical_name, related.canonical_name)
                relations.setdefault(
                    key,
                    ExtractedRelation(
                        relation_type='related_to',
                        from_name=anchor.canonical_name,
                        to_name=related.canonical_name,
                        weight=0.45,
                    ),
                )

    return GraphExtractionResult(
        entities=list(entities.values()),
        relations=list(relations.values()),
    )


def _candidate_phrases(text: str) -> list[str]:
    phrases = re.findall(r'[A-Za-z0-9_][A-Za-z0-9_\- ]{2,80}', text)
    results: list[str] = []
    for phrase in phrases:
        normalized = phrase.strip(' .,:;()[]{}"\'')
        canonical = _canonicalize(normalized)
        if not canonical or canonical in _STOPWORDS:
            continue
        if len(canonical) < 3:
            continue
        results.append(normalized)
    return results[:8]


def _pick_object_name(node: dict[str, Any]) -> str | None:
    for key in ('name', 'title', 'label', 'id', 'code', 'slug', 'topic', 'concept'):
        value = node.get(key)
        if isinstance(value, (str, int, float)) and str(value).strip():
            return str(value).strip()
    return None


def _relation_from_key(key: str) -> str:
    normalized = _canonicalize(key)
    if not normalized:
        return 'relates_to'
    return f'has_{normalized}'


def _augment_concept_map(payload: dict[str, Any], add_entity, add_relation) -> None:
    concepts = payload.get('concepts') or []
    for concept in concepts:
        if not isinstance(concept, dict) or not concept.get('name'):
            continue
        concept_name = str(concept['name']).strip()
        add_entity('Concept', concept_name, {'kind': 'concept'})
        for prerequisite in concept.get('prerequisites') or []:
            add_entity('Concept', str(prerequisite).strip(), {'kind': 'prerequisite'})
            add_relation('requires', concept_name, str(prerequisite).strip(), 1.0)
        for related in concept.get('relatedConcepts') or []:
            add_entity('Concept', str(related).strip(), {'kind': 'concept'})
            add_relation('related_to', concept_name, str(related).strip(), 0.8)


def _augment_qa_pairs(payload: dict[str, Any], add_entity, add_relation) -> None:
    entries = payload.get('entries') or []
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            continue
        question = str(entry.get('question') or '').strip()
        answer = str(entry.get('answer') or '').strip()
        topic = str(entry.get('topic') or '').strip()
        if not question or not answer:
            continue
        question_name = f'question_{index + 1}'
        add_entity('Question', question_name, {'question': question})
        add_entity('Answer', answer, {'kind': 'answer'})
        add_relation('answered_by', question_name, answer, 1.0)
        if topic:
            add_entity('Topic', topic, {'kind': 'topic'})
            add_relation('about_topic', question_name, topic, 0.9)


def _canonicalize(value: str | None) -> str:
    if value is None:
        return ''
    return re.sub(r'[^a-z0-9_]+', '_', str(value).strip().lower()).strip('_')


def _is_meaningful_scalar(value: Any) -> bool:
    if isinstance(value, bool):
        return True
    if isinstance(value, (int, float)):
        return True
    if isinstance(value, str):
        return bool(value.strip()) and len(value.strip()) >= 2
    return False
