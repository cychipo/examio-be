from src.genai_tutor.knowledge_base.json_dataset_parser import normalize_json_dataset


def test_normalize_curriculum_dataset() -> None:
    normalized, dataset_type = normalize_json_dataset(
        '{"course": {"name": "Python Basics", "code": "CS101"}, "chapters": [{"title": "Variables", "lessons": ["Strings", "Numbers"]}]}'
    )

    assert dataset_type == 'curriculum'
    assert 'Python Basics' in normalized
    assert 'Variables' in normalized


def test_normalize_glossary_dataset() -> None:
    normalized, dataset_type = normalize_json_dataset(
        '[{"term": "Loop", "definition": "Repeats a block", "examples": ["for", "while"]}]'
    )

    assert dataset_type == 'glossary'
    assert 'Loop' in normalized


def test_reject_unsupported_dataset() -> None:
    try:
        normalize_json_dataset('{"foo": "bar"}')
    except ValueError as error:
        assert 'Unsupported JSON dataset schema' in str(error)
    else:
        raise AssertionError('Expected normalize_json_dataset to reject unsupported schema')
