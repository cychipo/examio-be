from dataclasses import dataclass
from typing import Any, Dict, List, Literal


ModelProvider = Literal['gemini', 'ollama']
ModelTask = Literal['generation', 'chat', 'embedding']


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


GENERATION_MODELS: tuple[ModelRegistryEntry, ...] = (
    ModelRegistryEntry(
        id='qwen3_8b',
        provider='ollama',
        runtime_model_name='qwen3:8b',
        display_name='Qwen3 8B',
        description='Model local can bang giua toc do va chat luong.',
        task_types=('generation', 'chat'),
        enabled=True,
        is_default=True,
        supports_structured_output=True,
        badge='Mac dinh',
        sort_order=10,
        specs=(
            ModelSpec(label='Provider', value='Ollama'),
            ModelSpec(label='Tham so', value='8B'),
            ModelSpec(label='VRAM goi y', value='~10-12 GB'),
        ),
    ),
    ModelRegistryEntry(
        id='qwen3_32b',
        provider='ollama',
        runtime_model_name='qwen3:32b',
        display_name='Qwen3 32B',
        description='Model local manh hon cho bai toan can chat luong cao.',
        task_types=('generation', 'chat'),
        enabled=True,
        is_default=False,
        supports_structured_output=True,
        badge='Manh',
        sort_order=20,
        specs=(
            ModelSpec(label='Provider', value='Ollama'),
            ModelSpec(label='Tham so', value='32B'),
            ModelSpec(label='VRAM goi y', value='~40+ GB'),
        ),
    ),
    ModelRegistryEntry(
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
        sort_order=30,
        specs=(
            ModelSpec(label='Provider', value='Google'),
            ModelSpec(label='Kieu', value='Cloud'),
            ModelSpec(label='Rotation', value='API key + model'),
        ),
    ),
    ModelRegistryEntry(
        id='glm4_9b',
        provider='ollama',
        runtime_model_name='glm4:latest',
        display_name='GLM-4 9B',
        description='Model local kich thuoc vua, hop cho chat va generate thong thuong.',
        task_types=('generation', 'chat'),
        enabled=True,
        is_default=False,
        supports_structured_output=True,
        sort_order=40,
        specs=(
            ModelSpec(label='Provider', value='Ollama'),
            ModelSpec(label='Tham so', value='9B'),
            ModelSpec(label='VRAM goi y', value='~12-14 GB'),
        ),
    ),
    ModelRegistryEntry(
        id='gemma2_9b',
        provider='ollama',
        runtime_model_name='gemma2:9b',
        display_name='Gemma 2 9B',
        description='Model local gon nhe, phu hop cho tac vu thong thuong.',
        task_types=('generation', 'chat'),
        enabled=True,
        is_default=False,
        supports_structured_output=True,
        sort_order=50,
        specs=(
            ModelSpec(label='Provider', value='Ollama'),
            ModelSpec(label='Tham so', value='9B'),
            ModelSpec(label='VRAM goi y', value='~12-14 GB'),
        ),
    ),
)


LEGACY_MODEL_ALIASES: dict[str, str] = {
    'fayedark': 'qwen3_8b',
    'ollama': 'qwen3_8b',
    'local': 'qwen3_8b',
}


ALL_MODELS: dict[str, ModelRegistryEntry] = {
    EMBEDDING_MODEL.id: EMBEDDING_MODEL,
    **{entry.id: entry for entry in GENERATION_MODELS},
}


def get_default_generation_model() -> ModelRegistryEntry:
    for entry in GENERATION_MODELS:
        if entry.is_default:
            return entry
    return GENERATION_MODELS[0]


def resolve_generation_model(model_id: str | None) -> ModelRegistryEntry:
    if not model_id:
        return get_default_generation_model()

    normalized = LEGACY_MODEL_ALIASES.get(model_id.strip().lower(), model_id.strip())
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
