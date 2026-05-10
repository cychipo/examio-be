"""
LLM Factory để tạo các instance model khác nhau dựa trên loại model đang hoạt động.
"""
import os
from typing import Optional

from langchain.callbacks.manager import CallbackManager
from langchain_core.language_models import BaseChatModel
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_ollama import ChatOllama
from langchain_openai import ChatOpenAI

from .model_manager import ModelType, ModelUnavailableError, model_manager


class LLMFactory:
    """Factory để tạo các instance LLM khác nhau dựa trên cấu hình."""

    @classmethod
    def create_llm(cls, callback_manager: Optional[CallbackManager] = None) -> BaseChatModel:
        """
        Tạo instance LLM dựa trên model đang hoạt động với fallback logic.
        """
        model_type = model_manager.get_model_type()
        temperature = model_manager.get_temperature()
        max_tokens = model_manager.get_max_tokens()

        if model_type == ModelType.AI2:
            return cls._create_ai2_model(temperature, model_manager.get_ai2_max_tokens(), callback_manager)

        if model_type == ModelType.OLLAMA:
            return cls._create_ollama_model(temperature, max_tokens, callback_manager)

        return cls._create_gemini_model(temperature, max_tokens)

    @classmethod
    def create_llm_for_model(
        cls,
        model_id: str,
        callback_manager: Optional[CallbackManager] = None,
    ) -> BaseChatModel:
        model = model_manager.resolve_model(model_id)
        temperature = model_manager.get_temperature()
        max_tokens = model_manager.get_max_tokens()

        if model.provider == 'ai2':
            return cls._create_ai2_model(temperature, model_manager.get_ai2_max_tokens(), callback_manager, model.id)

        if model.provider == 'ollama':
            return ChatOllama(
                model=model.runtime_model_name,
                base_url=model_manager.get_ollama_info(model.id)["url"],
                temperature=temperature,
                num_predict=max_tokens,
                callback_manager=callback_manager,
            )

        return cls._create_gemini_model(temperature, max_tokens)

    @classmethod
    def _create_ai2_model(
        cls,
        temperature: float,
        max_tokens: int,
        callback_manager: Optional[CallbackManager] = None,
        model_id: str | None = None,
    ) -> BaseChatModel:
        ai2_info = model_manager.get_ai2_info(model_id)
        if not ai2_info['api_key_configured']:
            raise ModelUnavailableError(
                'AI2_API_KEY chua duoc cau hinh cho tac vu sinh content.',
                code='MODEL_CONFIGURATION_ERROR',
            )
        return ChatOpenAI(
            model=ai2_info['model'],
            api_key=os.getenv('AI2_API_KEY'),
            base_url=ai2_info['url'],
            temperature=temperature,
            max_tokens=max_tokens,
            callback_manager=callback_manager,
        )

    @classmethod
    def _create_ollama_model(
        cls,
        temperature: float,
        max_tokens: int,
        callback_manager: Optional[CallbackManager] = None,
    ) -> ChatOllama:
        ollama_info = model_manager.get_ollama_info()
        return ChatOllama(
            model=ollama_info["model"],
            base_url=ollama_info["url"],
            temperature=temperature,
            num_predict=max_tokens,
            callback_manager=callback_manager
        )

    @classmethod
    def _create_gemini_model(
        cls,
        temperature: float,
        max_tokens: int,
        callback_manager: Optional[CallbackManager] = None,
    ) -> BaseChatModel:
        gemini_info = model_manager.get_gemini_info()
        api_keys_str = os.getenv('GEMINI_API_KEYS', '')
        api_key = api_keys_str.split(',')[0].strip() if api_keys_str else os.getenv('GEMINI_API_KEY')
        return ChatGoogleGenerativeAI(
            model=gemini_info['model'],
            google_api_key=api_key,
            temperature=temperature,
            max_output_tokens=max_tokens,
            convert_system_message_to_human=True,
            callback_manager=callback_manager,
        )
