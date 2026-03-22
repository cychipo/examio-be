"""
Model Manager Module de quan ly da model generation/chat va embedding.
"""

import logging
import os
from enum import Enum
from typing import Any, Dict, Optional

import httpx

from dotenv import load_dotenv

from src.llm.model_registry import (
    get_default_generation_model,
    get_embedding_model,
    get_frontend_model_catalog,
    resolve_generation_model,
)

load_dotenv()

logger = logging.getLogger(__name__)


class ModelType(str, Enum):
    OLLAMA = 'ollama'
    GEMINI = 'gemini'


class AIModelType(str, Enum):
    GEMINI = 'gemini'
    QWEN3_8B = 'qwen3_8b'
    QWEN3_32B = 'qwen3_32b'
    GLM4_9B = 'glm4_9b'
    GEMMA2_9B = 'gemma2_9b'
    FAYEDARK = 'fayedark'


class ModelUnavailableError(Exception):
    def __init__(self, message: str, code: str = 'MODEL_UNAVAILABLE') -> None:
        super().__init__(message)
        self.code = code


class ModelManager:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(ModelManager, cls).__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return

        self._runtime_model_id: Optional[str] = None
        self._runtime_model_type: Optional[ModelType] = None
        self._runtime_ollama_model: Optional[str] = None
        self._runtime_gemini_model: Optional[str] = None
        self._initialized = True

    def get_model_parameter(self, param_name: str, default_value: Any = None) -> Any:
        env_map = {
            'temperature': 'DEFAULT_TEMPERATURE',
            'max_tokens': 'DEFAULT_MAX_TOKENS',
        }
        env_key = env_map.get(param_name)
        if env_key:
            val = os.getenv(env_key)
            if val:
                try:
                    if param_name == 'temperature':
                        return float(val)
                    if param_name == 'max_tokens':
                        return int(val)
                except Exception:
                    pass
        return default_value

    def get_temperature(self) -> float:
        val = self.get_model_parameter('temperature', 0.7)
        return float(val) if val is not None else 0.7

    def get_max_tokens(self) -> int:
        val = self.get_model_parameter('max_tokens', 2048)
        return int(val) if val is not None else 2048

    def get_default_model_id(self) -> str:
        env_model = os.getenv('DEFAULT_MODEL_ID')
        if env_model:
            try:
                return resolve_generation_model(env_model).id
            except ValueError:
                logger.warning('Invalid DEFAULT_MODEL_ID=%s, using registry default', env_model)
        return get_default_generation_model().id

    def resolve_model(self, model_id: str | None = None):
        runtime_model_id = model_id or self._runtime_model_id or self.get_default_model_id()
        return resolve_generation_model(runtime_model_id)

    def get_model_type(self) -> ModelType:
        if self._runtime_model_type is not None:
            return self._runtime_model_type
        model = self.resolve_model()
        return ModelType(model.provider)

    def get_current_model_id(self) -> str:
        return self.resolve_model().id

    def get_ollama_info(self, model_id: str | None = None) -> Dict[str, Any]:
        model = self.resolve_model(model_id)
        return {
            'model': self._runtime_ollama_model or model.runtime_model_name,
            'url': os.getenv('OLLAMA_BASE_URL', 'http://localhost:11434').rstrip('/'),
            'id': model.id,
        }

    def get_gemini_info(self, model_id: str | None = None) -> Dict[str, Any]:
        model = self.resolve_model(model_id)
        return {
            'model': self._runtime_gemini_model or os.getenv('GEMINI_MODEL', 'gemini-2.5-flash'),
            'id': model.id,
            'runtime_model_name': model.runtime_model_name,
        }

    def get_embedding_info(self) -> Dict[str, Any]:
        model = get_embedding_model()
        return {
            'id': model.id,
            'model': model.runtime_model_name,
            'url': os.getenv('OLLAMA_BASE_URL', 'http://localhost:11434').rstrip('/'),
        }

    async def check_generation_model_availability(
        self,
        model_id: str,
    ) -> Dict[str, Any]:
        model = self.resolve_model(model_id)

        if model.provider == 'gemini':
            return {
                'modelId': model.id,
                'available': True,
                'reason': None,
            }

        ollama_info = self.get_ollama_info(model.id)
        verify_ssl = os.getenv('OLLAMA_VERIFY_SSL', 'true').lower() == 'true'
        tags_url = f"{ollama_info['url'].rstrip('/')}/api/tags"

        try:
            async with httpx.AsyncClient(timeout=30.0, verify=verify_ssl, trust_env=False) as client:
                response = await client.get(tags_url)
                response.raise_for_status()
                data = response.json()
                models = data.get('models', [])
                installed_names = {
                    item.get('name')
                    for item in models
                    if isinstance(item, dict) and item.get('name')
                }

            if model.runtime_model_name not in installed_names:
                return {
                    'modelId': model.id,
                    'available': False,
                    'reason': 'Model chua duoc cai dat tren runtime.',
                }

            return {
                'modelId': model.id,
                'available': True,
                'reason': None,
            }
        except Exception as error:
            normalized_error = self._normalize_model_error(error)
            return {
                'modelId': model.id,
                'available': False,
                'reason': str(normalized_error),
                'code': normalized_error.code,
            }

    async def ensure_generation_model_ready(self, model_id: str) -> None:
        availability = await self.check_generation_model_availability(model_id)
        if not availability.get('available'):
            raise ModelUnavailableError(
                availability.get('reason') or 'Model is unavailable',
                code=availability.get('code', 'MODEL_UNAVAILABLE'),
            )

    async def get_frontend_model_catalog(self) -> Dict[str, Any]:
        availability_map: Dict[str, Dict[str, Any]] = {}
        for model_id in [
            'qwen3_8b',
            'qwen3_32b',
            'gemini',
            'glm4_9b',
            'gemma2_9b',
        ]:
            availability_map[model_id] = await self.check_generation_model_availability(
                model_id
            )

        return get_frontend_model_catalog(availability=availability_map)

    def set_active_model_type(self, model_type: ModelType) -> None:
        self._runtime_model_type = model_type

    def set_active_model_id(self, model_id: str) -> None:
        model = resolve_generation_model(model_id)
        self._runtime_model_id = model.id
        self._runtime_model_type = ModelType(model.provider)
        if model.provider == 'ollama':
            self._runtime_ollama_model = model.runtime_model_name
        else:
            self._runtime_gemini_model = os.getenv('GEMINI_MODEL', 'gemini-2.5-flash')

    def set_ollama_model(self, ollama_model: str) -> None:
        self._runtime_ollama_model = ollama_model
        self.set_active_model_type(ModelType.OLLAMA)

    def set_gemini_model(self, gemini_model: str) -> None:
        self._runtime_gemini_model = gemini_model
        self.set_active_model_type(ModelType.GEMINI)

    async def generate_content(self, prompt: str) -> str:
        return await self.generate_content_with_model(prompt, self.get_current_model_id())

    def _normalize_model_error(self, error: Exception) -> ModelUnavailableError:
        message = str(error)
        lower_message = message.lower()

        if 'vram' in lower_message or 'memory' in lower_message or 'insufficient' in lower_message:
            return ModelUnavailableError(message, code='MODEL_INSUFFICIENT_VRAM')
        if 'not found' in lower_message or '404' in lower_message or 'pull' in lower_message:
            return ModelUnavailableError(message, code='MODEL_UNAVAILABLE')
        if 'connect' in lower_message or 'timeout' in lower_message:
            return ModelUnavailableError(message, code='MODEL_UNAVAILABLE')
        return ModelUnavailableError(message, code='MODEL_RUNTIME_ERROR')

    async def _generate_with_gemini(
        self,
        prompt: str,
        system_prompt: str | None = None,
    ) -> str:
        import asyncio
        import google.generativeai as genai  # type: ignore[import-untyped]
        from google.api_core.exceptions import ResourceExhausted

        api_keys_str = os.getenv('GEMINI_API_KEYS', '')
        api_keys = [k.strip() for k in api_keys_str.split(',') if k.strip()]

        if not api_keys:
            single_key = os.getenv('GEMINI_API_KEY', '')
            if single_key:
                api_keys = [single_key]

        if not api_keys:
            raise ValueError('No Gemini API key configured')

        model_names_str = os.getenv(
            'GEMINI_MODEL_NAMES',
            'gemini-2.5-flash-lite,gemini-2.5-flash,gemini-2.5-pro,gemini-3-pro-preview,gemini-2.0-flash,gemini-2.0-flash-001,gemini-2.0-flash-lite,gemini-2.0-flash-lite-001',
        )
        model_names = [m.strip() for m in model_names_str.split(',') if m.strip()]

        if self._runtime_gemini_model and self._runtime_gemini_model not in model_names:
            model_names.insert(0, self._runtime_gemini_model)

        last_error = None
        for api_key in api_keys:
            for model_name in model_names:
                try:
                    configure = getattr(genai, 'configure')
                    generative_model_cls = getattr(genai, 'GenerativeModel')
                    generation_types = getattr(genai, 'types')

                    configure(api_key=api_key)
                    model = generative_model_cls(model_name)
                    loop = asyncio.get_running_loop()
                    final_prompt = (
                        f"{system_prompt}\n\nUSER TASK:\n{prompt}"
                        if system_prompt
                        else prompt
                    )
                    response = await loop.run_in_executor(
                        None,
                        lambda: model.generate_content(
                            final_prompt,
                            generation_config=generation_types.GenerationConfig(
                                temperature=self.get_temperature(),
                                max_output_tokens=self.get_max_tokens(),
                            ),
                        ),
                    )
                    return response.text
                except ResourceExhausted as error:
                    last_error = error
                    continue
                except Exception as error:
                    last_error = error
                    continue

        raise last_error or ValueError('All API keys and models exhausted')

    async def _generate_with_ollama(
        self,
        prompt: str,
        model_id: str,
        response_model: Any = None,
        system_prompt: str | None = None,
    ) -> str:
        import asyncio
        import httpx

        ollama_info = self.get_ollama_info(model_id)
        base_url = ollama_info['url'].rstrip('/')
        url = f"{base_url}/api/generate"
        verify_ssl = os.getenv('OLLAMA_VERIFY_SSL', 'true').lower() == 'true'

        payload = {
            'model': ollama_info['model'],
            'prompt': prompt,
            'stream': False,
            'options': {
                'temperature': self.get_temperature(),
                'num_predict': self.get_max_tokens(),
                'num_ctx': 4096,
            },
        }

        if system_prompt:
            payload['system'] = system_prompt

        if response_model:
            payload['format'] = response_model.model_json_schema()

        max_retries = 3
        last_error = None
        for attempt in range(max_retries):
            try:
                async with httpx.AsyncClient(timeout=3600.0, verify=verify_ssl, trust_env=False) as client:
                    response = await client.post(url, json=payload)
                    response.raise_for_status()
                    data = response.json()
                    return data.get('response', '')
            except httpx.HTTPStatusError as error:
                last_error = error
                if error.response.status_code >= 500 and attempt < max_retries - 1:
                    if attempt == 0 and 'format' in payload:
                        payload = {k: v for k, v in payload.items() if k != 'format'}
                    await asyncio.sleep((attempt + 1) * 2)
                    continue
                raise self._normalize_model_error(error)
            except (httpx.ConnectError, httpx.ConnectTimeout) as error:
                last_error = error
                if attempt < max_retries - 1:
                    await asyncio.sleep((attempt + 1) * 2)
                    continue
                raise self._normalize_model_error(error)
            except Exception as error:
                raise self._normalize_model_error(error)

        raise self._normalize_model_error(last_error or Exception('Ollama generation failed'))

    async def generate_content_with_model(
        self,
        prompt: str,
        ai_model_type: AIModelType | str = AIModelType.GEMINI,
        response_model: Any = None,
        system_prompt: str | None = None,
    ) -> str:
        model_id = ai_model_type.value if isinstance(ai_model_type, AIModelType) else str(ai_model_type)
        model = self.resolve_model(model_id)

        await self.ensure_generation_model_ready(model.id)

        if model.provider == 'gemini':
            return await self._generate_with_gemini(prompt, system_prompt=system_prompt)
        return await self._generate_with_ollama(
            prompt,
            model.id,
            response_model,
            system_prompt=system_prompt,
        )

    def get_langchain_model(self, ai_model_type: AIModelType | str = AIModelType.GEMINI):
        from langchain_google_genai import ChatGoogleGenerativeAI
        from langchain_ollama import ChatOllama

        model_id = ai_model_type.value if isinstance(ai_model_type, AIModelType) else str(ai_model_type)
        model = self.resolve_model(model_id)

        if model.provider == 'gemini':
            gemini_info = self.get_gemini_info(model.id)
            api_keys_str = os.getenv('GEMINI_API_KEYS', '')
            api_key = api_keys_str.split(',')[0].strip() if api_keys_str else os.getenv('GEMINI_API_KEY')
            return ChatGoogleGenerativeAI(
                model=gemini_info['model'],
                google_api_key=api_key,
                temperature=self.get_temperature(),
                max_output_tokens=self.get_max_tokens(),
                convert_system_message_to_human=True,
            )

        ollama_info = self.get_ollama_info(model.id)
        return ChatOllama(
            base_url=ollama_info['url'],
            model=ollama_info['model'],
            temperature=self.get_temperature(),
            format='json' if model.supports_structured_output else '',
        )


model_manager = ModelManager()
