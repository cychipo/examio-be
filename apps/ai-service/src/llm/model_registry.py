import os
from dataclasses import dataclass
from typing import Any, Dict, List, Literal


ModelProvider = Literal['gemini', 'ollama', 'ai2']
ModelTask = Literal['generation', 'chat', 'embedding']


DEFAULT_AI2_GENERATION_MODEL_NAMES = (
    'minimax-m2.5-free',
    'nemotron-3-super-free',
    'trinity-large-preview-free',
)


@dataclass(frozen=True)
class ModelSpec:
    label: str
    value: str


@dataclass(frozen=True)
class ModelRegistryEntry:
    id: str
    provider: ModelProvider
    runtime_model_name: str
    display_name: str
    description: str
    task_types: tuple[ModelTask, ...]
    enabled: bool = True
    is_default: bool = False
    supports_structured_output: bool = True
    badge: str | None = None
    sort_order: int = 0
    specs: tuple[ModelSpec, ...] = ()


def _split_env_list(value: str | None) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(',') if item.strip()]


def _get_ai2_generation_model_names() -> tuple[str, ...]:
    names = _split_env_list(os.getenv('AI2_GENERATION_MODEL_NAMES'))
    if not names:
        names = list(DEFAULT_AI2_GENERATION_MODEL_NAMES)

    unique_names: list[str] = []
    for name in names:
        if name not in unique_names:
            unique_names.append(name)

    default_name = os.getenv('AI2_DEFAULT_MODEL', DEFAULT_AI2_GENERATION_MODEL_NAMES[0]).strip()
    if default_name and default_name not in unique_names:
        unique_names.insert(0, default_name)

    return tuple(unique_names)


def _get_ai2_default_model_name(model_names: tuple[str, ...]) -> str:
    default_name = os.getenv('AI2_DEFAULT_MODEL', DEFAULT_AI2_GENERATION_MODEL_NAMES[0]).strip()
    return default_name if default_name in model_names else model_names[0]


def _format_ai2_display_name(model_name: str) -> str:
    return model_name.replace('-', ' ').replace('.', ' ').title()


EMBEDDING_MODEL = ModelRegistryEntry(
    id='qwen3_embedding_8b',
    provider='ollama',
    runtime_model_name='qwen3-embedding:latest',
    display_name='Qwen3 Embedding 8B',
    description='Embedding model dung chung cho toan bo he thong.',
    task_types=('embedding',),
    enabled=True,
    is_default=True,
    supports_structured_output=False,
    sort_order=0,
    specs=(
        ModelSpec(label='Loai', value='Embedding'),
        ModelSpec(label='Runtime', value='qwen3-embedding:latest'),
    ),
)


AI2_GENERATION_MODEL_NAMES = _get_ai2_generation_model_names()
AI2_DEFAULT_MODEL_NAME = _get_ai2_default_model_name(AI2_GENERATION_MODEL_NAMES)

AI2_GENERATION_MODELS: tuple[ModelRegistryEntry, ...] = tuple(
    ModelRegistryEntry(
        id=model_name,
        provider='ai2',
        runtime_model_name=model_name,
        display_name=_format_ai2_display_name(model_name),
        description='AI2 OpenAI-compatible model dung cho sinh quiz va flashcard.',
        task_types=('generation', 'chat'),
        enabled=True,
        is_default=model_name == AI2_DEFAULT_MODEL_NAME,
        supports_structured_output=False,
        badge='Mac dinh' if model_name == AI2_DEFAULT_MODEL_NAME else 'AI2',
        sort_order=(index + 1) * 10,
        specs=(
            ModelSpec(label='Provider', value='AI2'),
            ModelSpec(label='Runtime', value=model_name),
            ModelSpec(label='Kieu', value='OpenAI-compatible chat completions'),
        ),
    )
    for index, model_name in enumerate(AI2_GENERATION_MODEL_NAMES)
)

GEMINI_MODEL = ModelRegistryEntry(
    id='gemini',
    provider='gemini',
    runtime_model_name='gemini',
    display_name='Gemini',
    description='Cloud model giu nguyen co che rotate key va model tu env.',
    task_types=('generation', 'chat'),
    enabled=True,
    is_default=False,
    supports_structured_output=False,
    badge='Cloud',
    sort_order=40,
    specs=(
        ModelSpec(label='Provider', value='Google'),
        ModelSpec(label='Kieu', value='Cloud'),
        ModelSpec(label='Rotation', value='API key + model'),
    ),
)

GENERATION_MODELS: tuple[ModelRegistryEntry, ...] = (*AI2_GENERATION_MODELS, GEMINI_MODEL)


LEGACY_MODEL_ALIASES: dict[str, str] = {
    'fayedark': '__default__',
    'ollama': '__default__',
    'local': '__default__',
    'qwen3_8b': '__default__',
    'qwen3_32b': '__default__',
    'glm4_9b': '__default__',
    'gemma2_9b': '__default__',
    'ai2': '__default__',
}


ALL_MODELS: dict[str, ModelRegistryEntry] = {
    EMBEDDING_MODEL.id: EMBEDDING_MODEL,
    **{entry.id: entry for entry in GENERATION_MODELS},
}


def get_generation_models() -> tuple[ModelRegistryEntry, ...]:
    return GENERATION_MODELS


def get_default_generation_model() -> ModelRegistryEntry:
    for entry in GENERATION_MODELS:
        if entry.is_default:
            return entry
    return GENERATION_MODELS[0]


def resolve_generation_model(model_id: str | None) -> ModelRegistryEntry:
    if not model_id:
        return get_default_generation_model()

    requested_model_id = model_id.strip()
    normalized = LEGACY_MODEL_ALIASES.get(requested_model_id.lower(), requested_model_id)
    if normalized == '__default__':
        return get_default_generation_model()

    entry = ALL_MODELS.get(normalized)
    if not entry or 'generation' not in entry.task_types:
        raise ValueError(f'Unknown generation model: {model_id}')
    if not entry.enabled:
        raise ValueError(f'Model is disabled: {model_id}')
    return entry


def get_embedding_model() -> ModelRegistryEntry:
    return EMBEDDING_MODEL


def _entry_to_frontend_dto(entry: ModelRegistryEntry) -> Dict[str, Any]:
    return {
        'id': entry.id,
        'name': entry.display_name,
        'description': entry.description,
        'provider': entry.provider,
        'runtimeModelName': entry.runtime_model_name,
        'badge': entry.badge,
        'disabled': not entry.enabled,
        'isDefault': entry.is_default,
        'supportsStructuredOutput': entry.supports_structured_output,
        'specs': [{'label': spec.label, 'value': spec.value} for spec in entry.specs],
    }


def get_frontend_model_catalog(
    availability: Dict[str, Dict[str, Any]] | None = None,
) -> Dict[str, Any]:
    generation_models = sorted(GENERATION_MODELS, key=lambda item: item.sort_order)
    default_generation = get_default_generation_model()

    generation_model_dtos: List[Dict[str, Any]] = []
    for model in generation_models:
        dto = _entry_to_frontend_dto(model)
        model_availability = (availability or {}).get(model.id)
        if model_availability:
            dto['available'] = model_availability.get('available', True)
            dto['availabilityReason'] = model_availability.get('reason')
            if not model_availability.get('available', True):
                dto['disabled'] = True
        else:
            dto['available'] = True
            dto['availabilityReason'] = None
        generation_model_dtos.append(dto)

    return {
        'embeddingModel': _entry_to_frontend_dto(EMBEDDING_MODEL),
        'generationModels': generation_model_dtos,
        'defaultGenerationModel': default_generation.id,
    }
