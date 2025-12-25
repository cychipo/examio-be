"""
LLM Factory để tạo các instance model khác nhau dựa trên loại model đang hoạt động.
"""
from typing import Optional, Dict, Any, List
from langchain_core.language_models import BaseChatModel
from langchain.callbacks.manager import CallbackManager
from langchain_ollama import ChatOllama
from langchain_google_genai import ChatGoogleGenerativeAI
import os

from .HFChatModel import HuggingFaceChatModel
from .model_manager import model_manager, ModelType

class LLMFactory:
    """Factory để tạo các instance LLM khác nhau dựa trên cấu hình."""

    @classmethod
    def create_llm(cls, callback_manager: Optional[CallbackManager] = None) -> BaseChatModel:
        """
        Tạo instance LLM dựa trên model đang hoạt động với fallback logic.

        Args:
            callback_manager: Optional callback manager cho tracing

        Returns:
            BaseChatModel: Instance LLM tương ứng
        """
        # Lấy loại model đang hoạt động
        model_type = model_manager.get_model_type()

        # Lấy các tham số chung
        temperature = model_manager.get_temperature()
        max_tokens = model_manager.get_max_tokens()

        # Tạo instance model tương ứng với fallback logic
        if model_type == ModelType.OLLAMA:
            try:
                print("🤖 Attempting to create Ollama model...")
                return cls._create_ollama_model(temperature, max_tokens, callback_manager)
            except Exception as e:
                print(f"⚠️ Ollama model failed: {e}")
                print("🔄 Falling back to Gemini model...")
                return cls._create_gemini_model(temperature, max_tokens, callback_manager)
        elif model_type == ModelType.GEMINI:
            return cls._create_gemini_model(temperature, max_tokens, callback_manager)
        else:  # HUGGINGFACE hoặc loại khác
            return cls._create_huggingface_model(temperature, max_tokens, callback_manager)

    @classmethod
    def _create_ollama_model(cls, temperature: float, max_tokens: int,
                            callback_manager: Optional[CallbackManager] = None) -> ChatOllama:
        """Tạo model Ollama."""
        ollama_info = model_manager.get_ollama_info()

        print(f"🔧 Creating ChatOllama with:")
        print(f"   - model: {ollama_info['model']}")
        print(f"   - url: {ollama_info['url']}")
        print(f"   - temperature: {temperature}")
        print(f"   - max_tokens: {max_tokens}")

        return ChatOllama(
            model=ollama_info["model"],
            base_url=ollama_info["url"],  # Try base_url instead of url
            temperature=temperature,
            num_predict=max_tokens,  # Try num_predict instead of max_tokens
            callback_manager=callback_manager
        )

    @classmethod
    def _create_gemini_model(cls, temperature: float, max_tokens: int,
                            callback_manager: Optional[CallbackManager] = None) -> ChatGoogleGenerativeAI:
        """Tạo model Gemini với multi-key/model rotation."""
        from .gemini_client import gemini_client

        # Sử dụng GeminiClient để lấy key/model với rotation
        return gemini_client.get_chat_model(temperature=temperature)

    @classmethod
    def _create_huggingface_model(cls, temperature: float, max_tokens: int,
                                callback_manager: Optional[CallbackManager] = None) -> HuggingFaceChatModel:
        """Tạo model Hugging Face."""
        hf_info = model_manager.get_huggingface_info()

        # Đặt HF_TOKEN
        os.environ["HF_TOKEN"] = hf_info["token"]

        return HuggingFaceChatModel(
            model_path=hf_info["model"],
            temperature=temperature,
            max_tokens=max_tokens
        )
