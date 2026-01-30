"""
LLM Factory để tạo các instance model khác nhau dựa trên loại model đang hoạt động.
Tối giản: Tập trung vào Gemini và Ollama. Loại bỏ HuggingFace.
"""
from typing import Optional, Dict, Any, List
from langchain_core.language_models import BaseChatModel
from langchain.callbacks.manager import CallbackManager
from langchain_ollama import ChatOllama
import os

from .model_manager import model_manager, ModelType

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

        if model_type == ModelType.OLLAMA:
            try:
                return cls._create_ollama_model(temperature, max_tokens, callback_manager)
            except Exception as e:
                import logging
                logger = logging.getLogger(__name__)
                logger.warning(f"Ollama connection unsuccessful, falling back to Gemini: {e}")
                return cls._create_gemini_model(temperature, max_tokens, callback_manager)

        # Default is Gemini
        return cls._create_gemini_model(temperature, max_tokens, callback_manager)

    @classmethod
    def _create_ollama_model(cls, temperature: float, max_tokens: int,
                            callback_manager: Optional[CallbackManager] = None) -> ChatOllama:
        """Tạo model Ollama."""
        ollama_info = model_manager.get_ollama_info()
        return ChatOllama(
            model=ollama_info["model"],
            base_url=ollama_info["url"],
            temperature=temperature,
            num_predict=max_tokens,
            callback_manager=callback_manager
        )

    @classmethod
    def _create_gemini_model(cls, temperature: float, max_tokens: int,
                            callback_manager: Optional[CallbackManager] = None) -> BaseChatModel:
        """Tạo model Gemini với multi-key/model rotation."""
        from .gemini_client import gemini_client
        return gemini_client.get_chat_model(temperature=temperature)
