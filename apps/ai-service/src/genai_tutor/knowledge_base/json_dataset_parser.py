"""Validation and normalization helpers for structured JSON knowledge datasets."""

from __future__ import annotations

import json
from typing import Any


SUPPORTED_DATASET_TYPES = {
    'curriculum',
    'glossary',
    'qa_pairs',
    'concept_map',
}


def normalize_json_dataset(content: str) -> tuple[str, str]:
    try:
        payload = json.loads(content)
    except json.JSONDecodeError as exc:
        raise ValueError('JSON file is not valid') from exc

    dataset_type = _detect_dataset_type(payload)
    if dataset_type == 'curriculum':
        normalized = _normalize_curriculum(payload)
    elif dataset_type == 'glossary':
        normalized = _normalize_glossary(payload)
    elif dataset_type == 'qa_pairs':
        normalized = _normalize_qa_pairs(payload)
    elif dataset_type == 'concept_map':
        normalized = _normalize_concept_map(payload)
    else:
        raise ValueError(
            'Unsupported JSON dataset schema. Supported types: curriculum, glossary, qa_pairs, concept_map'
        )

    return json.dumps(normalized, ensure_ascii=False, indent=2), dataset_type


def _detect_dataset_type(payload: Any) -> str:
    if isinstance(payload, dict):
        explicit = payload.get('datasetType') or payload.get('type')
        if explicit in SUPPORTED_DATASET_TYPES:
            return explicit
        if 'chapters' in payload or 'modules' in payload:
            return 'curriculum'
        if 'entries' in payload:
            entries = payload['entries']
            if _list_has_keys(entries, {'term', 'definition'}):
                return 'glossary'
            if _list_has_keys(entries, {'question', 'answer'}):
                return 'qa_pairs'
        if 'concepts' in payload:
            return 'concept_map'
    if isinstance(payload, list):
        if _list_has_keys(payload, {'term', 'definition'}):
            return 'glossary'
        if _list_has_keys(payload, {'question', 'answer'}):
            return 'qa_pairs'
        if _list_has_keys(payload, {'name', 'prerequisites'}):
            return 'concept_map'
    return 'unsupported'


def _normalize_curriculum(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError('Curriculum dataset must be an object')

    course = payload.get('course') or {
        'name': payload.get('name') or payload.get('title') or 'Untitled curriculum',
        'code': payload.get('code') or payload.get('courseCode'),
    }
    chapters = payload.get('chapters') or payload.get('modules') or []
    if not isinstance(chapters, list) or not chapters:
        raise ValueError('Curriculum dataset requires a non-empty chapters/modules array')

    normalized_chapters = []
    for index, chapter in enumerate(chapters):
        if not isinstance(chapter, dict):
            raise ValueError('Each curriculum chapter/module must be an object')
        title = chapter.get('title') or chapter.get('name') or f'Chapter {index + 1}'
        lessons = chapter.get('lessons') or chapter.get('topics') or []
        normalized_lessons = []
        for lesson_index, lesson in enumerate(lessons):
            if isinstance(lesson, dict):
                normalized_lessons.append(
                    {
                        'name': lesson.get('name') or lesson.get('title') or f'Lesson {lesson_index + 1}',
                        'summary': lesson.get('summary') or lesson.get('description'),
                        'objectives': lesson.get('objectives') or [],
                    }
                )
            elif isinstance(lesson, str):
                normalized_lessons.append({'name': lesson, 'summary': None, 'objectives': []})
        normalized_chapters.append(
            {
                'title': title,
                'summary': chapter.get('summary') or chapter.get('description'),
                'lessons': normalized_lessons,
            }
        )

    return {
        'datasetType': 'curriculum',
        'course': {
            'name': course.get('name') or 'Untitled curriculum',
            'code': course.get('code'),
        },
        'chapters': normalized_chapters,
    }


def _normalize_glossary(payload: Any) -> dict[str, Any]:
    entries = payload.get('entries') if isinstance(payload, dict) else payload
    if not isinstance(entries, list) or not entries:
        raise ValueError('Glossary dataset requires a non-empty entries array')

    normalized_entries = []
    for entry in entries:
        if not isinstance(entry, dict) or not entry.get('term') or not entry.get('definition'):
            raise ValueError('Each glossary entry requires term and definition')
        normalized_entries.append(
            {
                'term': str(entry['term']).strip(),
                'definition': str(entry['definition']).strip(),
                'aliases': [str(alias).strip() for alias in entry.get('aliases') or [] if str(alias).strip()],
                'examples': [str(example).strip() for example in entry.get('examples') or [] if str(example).strip()],
            }
        )

    return {'datasetType': 'glossary', 'entries': normalized_entries}


def _normalize_qa_pairs(payload: Any) -> dict[str, Any]:
    entries = payload.get('entries') if isinstance(payload, dict) else payload
    if not isinstance(entries, list) or not entries:
        raise ValueError('QA dataset requires a non-empty entries array')

    normalized_entries = []
    for entry in entries:
        if not isinstance(entry, dict) or not entry.get('question') or not entry.get('answer'):
            raise ValueError('Each QA entry requires question and answer')
        normalized_entries.append(
            {
                'question': str(entry['question']).strip(),
                'answer': str(entry['answer']).strip(),
                'topic': entry.get('topic'),
                'difficulty': entry.get('difficulty'),
                'keywords': [str(keyword).strip() for keyword in entry.get('keywords') or [] if str(keyword).strip()],
            }
        )

    return {'datasetType': 'qa_pairs', 'entries': normalized_entries}


def _normalize_concept_map(payload: Any) -> dict[str, Any]:
    concepts = payload.get('concepts') if isinstance(payload, dict) else payload
    if not isinstance(concepts, list) or not concepts:
        raise ValueError('Concept map dataset requires a non-empty concepts array')

    normalized_concepts = []
    for concept in concepts:
        if not isinstance(concept, dict) or not concept.get('name'):
            raise ValueError('Each concept requires a name')
        normalized_concepts.append(
            {
                'name': str(concept['name']).strip(),
                'description': concept.get('description'),
                'prerequisites': [str(item).strip() for item in concept.get('prerequisites') or [] if str(item).strip()],
                'relatedConcepts': [str(item).strip() for item in concept.get('relatedConcepts') or concept.get('related') or [] if str(item).strip()],
                'examples': [str(item).strip() for item in concept.get('examples') or [] if str(item).strip()],
            }
        )

    return {'datasetType': 'concept_map', 'concepts': normalized_concepts}


def _list_has_keys(items: Any, keys: set[str]) -> bool:
    return isinstance(items, list) and bool(items) and isinstance(items[0], dict) and keys.issubset(items[0].keys())
