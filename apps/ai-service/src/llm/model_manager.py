"""
Model Manager Module để quản lý các mô hình LLM (Stateless version).
Chỉ tập trung vào Gemini và Ollama.
"""
import os
from typing import Dict, Any, Optional
from dotenv import load_dotenv
from enum import Enum

# Load environment variables
load_dotenv()

class ModelType(str, Enum):
    OLLAMA = "ollama"
    GEMINI = "gemini"

class ModelManager:
    """Quản lý các mô hình LLM và tham số của chúng (Stateless)."""

    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(ModelManager, cls).__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return

        # Cache cho active model params
        self._active_model_params = None

        # Runtime model override
        self._runtime_model_type = None
        self._runtime_ollama_model = None
        self._runtime_gemini_model = None

        self._initialized = True

    def get_model_parameter(self, param_name: str, default_value: Any = None) -> Any:
        """Lấy giá trị tham số từ environment hoặc mặc định."""
        env_map = {
            "temperature": "DEFAULT_TEMPERATURE",
            "max_tokens": "DEFAULT_MAX_TOKENS",
        }

        env_key = env_map.get(param_name)
        if env_key and os.getenv(env_key):
            val = os.getenv(env_key)
            try:
                if param_name == "temperature": return float(val)
                if param_name == "max_tokens": return int(val)
            except:
                pass

        return default_value

    def get_model_type(self) -> ModelType:
        """Lấy loại model đang hoạt động."""
        if self._runtime_model_type:
            return self._runtime_model_type

        model_type_str = os.getenv("DEFAULT_MODEL_TYPE", "gemini").lower()
        if "ollama" in model_type_str:
            return ModelType.OLLAMA
        return ModelType.GEMINI

    def get_ollama_info(self) -> Dict[str, Any]:
        """Lấy cấu hình Ollama."""
        return {
            "model": self._runtime_ollama_model or os.getenv("RAG_MODEL", "qwen3:8b"),
            "url": os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
        }

    def get_gemini_info(self) -> Dict[str, Any]:
        """Lấy cấu hình Gemini."""
        return {
            "model": self._runtime_gemini_model or os.getenv("GEMINI_MODEL", "gemini-2.0-flash"),
        }

    def get_temperature(self) -> float:
        return self.get_model_parameter("temperature", 0.7)

    def get_max_tokens(self) -> int:
        return self.get_model_parameter("max_tokens", 2048)

    def set_active_model_type(self, model_type: ModelType) -> None:
        self._runtime_model_type = model_type

    def set_ollama_model(self, ollama_model: str) -> None:
        self._runtime_ollama_model = ollama_model
        self.set_active_model_type(ModelType.OLLAMA)

    def set_gemini_model(self, gemini_model: str) -> None:
        self._runtime_gemini_model = gemini_model
        self.set_active_model_type(ModelType.GEMINI)

# Singleton instance
model_manager = ModelManager()
