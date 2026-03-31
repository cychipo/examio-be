from src.genai_tutor.knowledge_base.graph_extractor import extract_knowledge_graph


def test_extract_knowledge_graph_from_json_dataset() -> None:
    result = extract_knowledge_graph(
        content='{"course": "Python Basics", "chapters": [{"name": "Variables", "lessons": ["Strings", "Numbers"]}]}',
        content_type='json',
        language='json',
        metadata={'sourceType': 'json'},
    )

    canonical_names = {entity.canonical_name for entity in result.entities}
    assert 'python_basics' in canonical_names
    assert 'variables' in canonical_names
    assert 'strings' in canonical_names
    assert any(relation.relation_type.startswith('has_') for relation in result.relations)


def test_extract_knowledge_graph_from_text_content() -> None:
    result = extract_knowledge_graph(
        content='Binary Search works with sorted arrays. Binary Search reduces the search space quickly.',
        content_type='text',
        language='text',
        metadata={'sourceType': 'pdf'},
    )

    assert result.entities
    assert any(relation.relation_type == 'related_to' for relation in result.relations)
