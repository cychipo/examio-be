"""Minimal code entity extraction helpers for tutor graph building."""

from __future__ import annotations

import ast
import re
from dataclasses import dataclass
from typing import Any


@dataclass
class ExtractedEntity:
    entity_type: str
    name: str
    canonical_name: str
    language: str
    properties: dict[str, Any]


@dataclass
class ExtractedRelation:
    relation_type: str
    from_name: str
    to_name: str
    weight: float


def extract_code_graph(content: str, language: str) -> tuple[list[ExtractedEntity], list[ExtractedRelation]]:
    if language == 'python':
        return _extract_python_graph(content)
    if language == 'c':
        return _extract_c_graph(content)
    return [], []


def _extract_python_graph(content: str) -> tuple[list[ExtractedEntity], list[ExtractedRelation]]:
    entities: list[ExtractedEntity] = []
    relations: list[ExtractedRelation] = []
    try:
        tree = ast.parse(content)
    except SyntaxError:
        return [], []

    current_scope = 'module'
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef):
            entities.append(
                ExtractedEntity(
                    entity_type='CodeEntity',
                    name=node.name,
                    canonical_name=node.name,
                    language='python',
                    properties={'kind': 'function', 'args': [arg.arg for arg in node.args.args]},
                )
            )
            current_scope = node.name
        elif isinstance(node, ast.ClassDef):
            entities.append(
                ExtractedEntity(
                    entity_type='CodeEntity',
                    name=node.name,
                    canonical_name=node.name,
                    language='python',
                    properties={'kind': 'class'},
                )
            )
            for base in node.bases:
                if isinstance(base, ast.Name):
                    relations.append(
                        ExtractedRelation(
                            relation_type='inherits',
                            from_name=node.name,
                            to_name=base.id,
                            weight=1.0,
                        )
                    )
        elif isinstance(node, ast.Import):
            for alias in node.names:
                entities.append(
                    ExtractedEntity(
                        entity_type='CodeEntity',
                        name=alias.name,
                        canonical_name=alias.name,
                        language='python',
                        properties={'kind': 'module'},
                    )
                )
        elif isinstance(node, ast.ImportFrom) and node.module:
            entities.append(
                ExtractedEntity(
                    entity_type='CodeEntity',
                    name=node.module,
                    canonical_name=node.module,
                    language='python',
                    properties={'kind': 'module'},
                )
            )
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            relations.append(
                ExtractedRelation(
                    relation_type='calls',
                    from_name=current_scope,
                    to_name=node.func.id,
                    weight=0.8,
                )
            )

    return _dedupe_entities(entities), _dedupe_relations(relations)


def _extract_c_graph(content: str) -> tuple[list[ExtractedEntity], list[ExtractedRelation]]:
    entities: list[ExtractedEntity] = []
    relations: list[ExtractedRelation] = []
    include_pattern = re.compile(r'#include\s+[<\"]([^>\"]+)[>\"]')
    function_pattern = re.compile(r'\b(?:int|void|char|float|double|long|short|unsigned|signed|static)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*\{')
    call_pattern = re.compile(r'\b([A-Za-z_][A-Za-z0-9_]*)\s*\(')

    for include in include_pattern.findall(content):
        entities.append(
            ExtractedEntity(
                entity_type='CodeEntity',
                name=include,
                canonical_name=include,
                language='c',
                properties={'kind': 'header'},
            )
        )

    function_names = []
    for name, args in function_pattern.findall(content):
        function_names.append(name)
        entities.append(
            ExtractedEntity(
                entity_type='CodeEntity',
                name=name,
                canonical_name=name,
                language='c',
                properties={'kind': 'function', 'args': args},
            )
        )

    current_scope = function_names[0] if function_names else 'translation_unit'
    for match in call_pattern.findall(content):
        if match in {'if', 'for', 'while', 'switch', 'return'}:
            continue
        if match != current_scope:
            relations.append(
                ExtractedRelation(
                    relation_type='calls',
                    from_name=current_scope,
                    to_name=match,
                    weight=0.8,
                )
            )

    return _dedupe_entities(entities), _dedupe_relations(relations)


def _dedupe_entities(entities: list[ExtractedEntity]) -> list[ExtractedEntity]:
    unique: dict[tuple[str, str, str], ExtractedEntity] = {}
    for entity in entities:
        unique[(entity.entity_type, entity.canonical_name, entity.language)] = entity
    return list(unique.values())


def _dedupe_relations(relations: list[ExtractedRelation]) -> list[ExtractedRelation]:
    unique: dict[tuple[str, str, str], ExtractedRelation] = {}
    for relation in relations:
        unique[(relation.relation_type, relation.from_name, relation.to_name)] = relation
    return list(unique.values())
