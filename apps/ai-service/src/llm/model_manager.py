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
    """Internal model type enum"""
    OLLAMA = "ollama"
    GEMINI = "gemini"


class AIModelType(str, Enum):
    """
    AI Model types exposed to API.
    - gemini: Google Gemini AI with key/model rotation
    - fayedark: FayeDark AI using Ollama local LLM
    """
    GEMINI = "gemini"
    FAYEDARK = "fayedark"

    @classmethod
    def to_model_type(cls, ai_model: "AIModelType") -> ModelType:
        """Convert AIModelType to internal ModelType"""
        if ai_model == cls.FAYEDARK:
            return ModelType.OLLAMA
        return ModelType.GEMINI

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
        if env_key:
            val = os.getenv(env_key)
            if val:
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
            "model": self._runtime_gemini_model or os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
        }

    def get_temperature(self) -> float:
        val = self.get_model_parameter("temperature", 0.7)
        return float(val) if val is not None else 0.7

    def get_max_tokens(self) -> int:
        val = self.get_model_parameter("max_tokens", 2048)
        return int(val) if val is not None else 2048

    def set_active_model_type(self, model_type: ModelType) -> None:
        self._runtime_model_type = model_type

    def set_ollama_model(self, ollama_model: str) -> None:
        self._runtime_ollama_model = ollama_model
        self.set_active_model_type(ModelType.OLLAMA)

    def set_gemini_model(self, gemini_model: str) -> None:
        self._runtime_gemini_model = gemini_model
        self.set_active_model_type(ModelType.GEMINI)

    async def generate_content(self, prompt: str) -> str:
        """
        Generate content using the active LLM model.

        Args:
            prompt: The prompt to send to the model

        Returns:
            Generated text response
        """
        model_type = self.get_model_type()

        if model_type == ModelType.GEMINI:
            return await self._generate_with_gemini(prompt)
        else:
            return await self._generate_with_ollama(prompt)

    async def _generate_with_gemini(self, prompt: str) -> str:
        """Generate content using Gemini API with key/model rotation on quota errors"""
        import google.generativeai as genai
        from google.api_core.exceptions import ResourceExhausted
        import logging

        logger = logging.getLogger(__name__)

        logger.info("Starting Gemini generation")

        # Get API key(s)
        api_keys_str = os.getenv("GEMINI_API_KEYS", "")
        api_keys = [k.strip() for k in api_keys_str.split(",") if k.strip()]

        if not api_keys:
            single_key = os.getenv("GEMINI_API_KEY", "")
            if single_key:
                api_keys = [single_key]

        if not api_keys:
            logger.error("No Gemini API key configured")
            raise ValueError("No Gemini API key configured")

        logger.info(f"Found {len(api_keys)} API keys")

        # Get model names
        model_names_str = os.getenv("GEMINI_MODEL_NAMES", "gemini-2.0-flash,gemini-1.5-flash,gemini-1.5-pro")
        model_names = [m.strip() for m in model_names_str.split(",") if m.strip()]

        logger.info(f"Using models: {model_names}")

        # If runtime model is set, use it first
        if self._runtime_gemini_model and self._runtime_gemini_model not in model_names:
            model_names.insert(0, self._runtime_gemini_model)

        last_error = None

        # Try all combinations of API keys and models
        for key_idx, api_key in enumerate(api_keys):
            for model_idx, model_name in enumerate(model_names):
                try:
                    logger.info(f"Trying key {key_idx + 1}/{len(api_keys)}, model: {model_name}")

                    genai.configure(api_key=api_key)
                    model = genai.GenerativeModel(model_name)

                    logger.info(f"Making API call to Gemini for model {model_name}")

                    temperature_val = self.get_temperature()
                    max_tokens_val = self.get_max_tokens()

                    logger.info(f"Using temperature: {temperature_val}, max_tokens: {max_tokens_val}")

                    response = model.generate_content(
                        prompt,
                        generation_config=genai.types.GenerationConfig(
                            temperature=temperature_val,
                            max_output_tokens=max_tokens_val,
                        )
                    )

                    logger.info(f"Successfully generated with key {key_idx + 1}, model: {model_name}")
                    return response.text

                except ResourceExhausted as e:
                    logger.warning(f"Quota exceeded for key {key_idx + 1}, model {model_name}. Trying next...")
                    last_error = e
                    continue
                except Exception as e:
                    logger.error(f"Error with key {key_idx + 1}, model {model_name}: {e}")
                    logger.error(f"Exception type: {type(e)}")
                    import traceback
                    logger.error(f"Traceback: {traceback.format_exc()}")
                    last_error = e
                    continue

        # All combinations failed
        logger.error(f"All combinations failed. Last error: {last_error}")
        raise last_error or ValueError("All API keys and models exhausted")

    async def _generate_with_ollama(self, prompt: str) -> str:
        """Generate content using Ollama"""
        import httpx

        ollama_info = self.get_ollama_info()
        url = f"{ollama_info['url']}/api/generate"

        async with httpx.AsyncClient(timeout=3600.0) as client:  # 60 minutes for large quiz generation
            response = await client.post(url, json={
                "model": ollama_info["model"],
                "prompt": prompt,
                "stream": False,
                "options": {
                    "temperature": self.get_temperature(),
                    "num_predict": self.get_max_tokens(),
                }
            })
            response.raise_for_status()
            data = response.json()
            return data.get("response", "")

    async def generate_content_with_model(
        self,
        prompt: str,
        ai_model_type: AIModelType = AIModelType.GEMINI
    ) -> str:
        """
        Generate content using a specific AI model type (thread-safe).

        This method does NOT change global state, making it safe for concurrent requests.

        Args:
            prompt: The prompt to send to the model
            ai_model_type: The AI model to use (gemini or fayedark)

        Returns:
            Generated text response
        """
        import logging
        logger = logging.getLogger(__name__)

        logger.info(f"Generating content with model type: {ai_model_type.value}")
        model_type = AIModelType.to_model_type(ai_model_type)

        if model_type == ModelType.GEMINI:
            logger.info("Using Gemini model")
            return await self._generate_with_gemini(prompt)
        else:
            logger.info("Using Ollama model")
            return await self._generate_with_ollama(prompt)


# Singleton instance
model_manager = ModelManager()
