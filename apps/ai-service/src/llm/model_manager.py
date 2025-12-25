"""
Model Manager Module để quản lý các mô hình LLM khác nhau.
"""
import os
from typing import Dict, Any, Optional
from dotenv import load_dotenv
from enum import Enum

# Load environment variables
load_dotenv()

class ModelType(str, Enum):
    HUGGINGFACE = "huggingface"
    OLLAMA = "ollama"
    GEMINI = "gemini"
    OTHER = "other"

class ModelManager:
    """Quản lý các mô hình LLM và tham số của chúng."""
    
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(ModelManager, cls).__new__(cls)
            cls._instance._initialized = False
        return cls._instance
    
    def __init__(self):
        if self._initialized:
            return
        
        # Skip MongoDB - chỉ dùng runtime và environment variables
        self.client = None
        self.db = None
        
        # Cache cho active model
        self._active_model = None
        self._active_model_params = None
        
        # Runtime model override (sẽ ghi đè lên DB config)
        self._runtime_model_type = None
        self._runtime_ollama_model = None
        self._runtime_gemini_model = None
        
        self._initialized = True
    
    def get_active_model(self) -> Dict[str, Any]:
        """
        Lấy thông tin về mô hình đang hoạt động.
        
        Returns:
            Dict[str, Any]: Thông tin của mô hình đang hoạt động, hoặc None nếu không có.
        """
        # Kiểm tra cache
        if self._active_model is not None:
            return self._active_model
        
        # Skip database - chỉ dùng environment variables và runtime overrides
        model = None
        
        if model:
            # Convert ObjectId to string
            model["id"] = str(model["_id"])
            del model["_id"]
            
            # Cập nhật cache
            self._active_model = model
            self._active_model_params = model.get("parameters", {})
            
            return model
        
        # Nếu không tìm thấy model nào đang active, lấy model mặc định từ env
        model_type = os.environ.get("DEFAULT_MODEL_TYPE", ModelType.HUGGINGFACE)
        
        default_model = {
            "id": "default",
            "name": os.environ.get("DEFAULT_MODEL_NAME", "LLaMA 3 (8B)"),
            "path": os.environ.get("DEFAULT_MODEL_PATH", "NousResearch/Hermes-2-Pro-Llama-3-8B"),
            "modelType": model_type,
            "isActive": True,
            "parameters": {
                "temperature": float(os.environ.get("DEFAULT_TEMPERATURE", "0.7")),
                "top_p": float(os.environ.get("DEFAULT_TOP_P", "0.9")),
                "top_k": int(os.environ.get("DEFAULT_TOP_K", "40")),
                "max_tokens": int(os.environ.get("DEFAULT_MAX_TOKENS", "2048")),
                "presence_penalty": float(os.environ.get("DEFAULT_PRESENCE_PENALTY", "0")),
                "frequency_penalty": float(os.environ.get("DEFAULT_FREQUENCY_PENALTY", "0")),
                "system_prompt": os.environ.get("DEFAULT_SYSTEM_PROMPT", "Bạn là trợ lý AI của Học viện Kỹ thuật Mật mã.")
            }
        }
        
        # Thêm thông tin đặc thù cho từng loại model
        if model_type == ModelType.GEMINI:
            default_model["api_key"] = os.environ.get("GEMINI_API_KEY", "")
            default_model["gemini_model"] = os.environ.get("DEFAULT_GEMINI_MODEL", "gemini-1.5-pro")
        elif model_type == ModelType.OLLAMA:
            default_model["ollama_model"] = os.environ.get("DEFAULT_OLLAMA_MODEL", "llama3")
            default_model["ollama_url"] = os.environ.get("OLLAMA_API_URL", "http://localhost:11434")
        elif model_type == ModelType.HUGGINGFACE:
            default_model["hf_token"] = os.environ.get("HF_TOKEN", "")
        
        self._active_model = default_model
        self._active_model_params = default_model.get("parameters", {})
        
        return default_model
    
    def get_model_parameter(self, param_name: str, default_value: Any = None) -> Any:
        """
        Lấy giá trị của một tham số cụ thể từ mô hình đang hoạt động.
        
        Args:
            param_name (str): Tên tham số cần lấy.
            default_value (Any, optional): Giá trị mặc định nếu tham số không tồn tại.
            
        Returns:
            Any: Giá trị của tham số.
        """
        # Đảm bảo đã có active model parameters
        if self._active_model_params is None:
            self.get_active_model()
        
        # Lấy giá trị tham số
        return self._active_model_params.get(param_name, default_value)
    
    def get_all_models(self):
        """
        Không cần database - models được quản lý qua runtime và environment.
        """
        return []
    
    def activate_model(self, model_id: str) -> bool:
        """
        Kích hoạt một mô hình cụ thể.
        
        Args:
            model_id (str): ID của mô hình cần kích hoạt.
            
        Returns:
            bool: True nếu thành công, False nếu thất bại.
        """
        try:
            # Vô hiệu hóa tất cả các mô hình
            self.db.llm_models.update_many(
                {},
                {"$set": {"isActive": False}}
            )
            
            # Kích hoạt mô hình được chỉ định
            result = self.db.llm_models.update_one(
                {"_id": ObjectId(model_id)},
                {"$set": {"isActive": True}}
            )
            
            # Reset cache
            self._active_model = None
            self._active_model_params = None
            
            return result.modified_count > 0
        except Exception as e:
            print(f"Error activating model: {str(e)}")
            return False
    
    def update_model_params(self, model_id: str, params: Dict[str, Any]) -> bool:
        """
        Cập nhật tham số cho một mô hình cụ thể.
        
        Args:
            model_id (str): ID của mô hình cần cập nhật.
            params (Dict[str, Any]): Các tham số mới.
            
        Returns:
            bool: True nếu thành công, False nếu thất bại.
        """
        try:
            result = self.db.llm_models.update_one(
                {"_id": ObjectId(model_id)},
                {"$set": {"parameters": params}}
            )
            
            # Nếu model đang active, reset cache
            active_model = self.get_active_model()
            if active_model and active_model.get("id") == model_id:
                self._active_model = None
                self._active_model_params = None
            
            return result.modified_count > 0
        except Exception as e:
            print(f"Error updating model parameters: {str(e)}")
            return False
    
    def create_model(self, model_data: Dict[str, Any]) -> Optional[str]:
        """
        Tạo một mô hình mới.
        
        Args:
            model_data (Dict[str, Any]): Thông tin mô hình mới.
            
        Returns:
            Optional[str]: ID của mô hình mới nếu thành công, None nếu thất bại.
        """
        try:
            result = self.db.llm_models.insert_one(model_data)
            return str(result.inserted_id)
        except Exception as e:
            print(f"Error creating model: {str(e)}")
            return None
    
    def get_system_prompt(self) -> str:
        """
        Lấy system prompt từ mô hình đang hoạt động.
        
        Returns:
            str: System prompt.
        """
        return self.get_model_parameter("system_prompt", "Bạn là trợ lý AI của Học viện Kỹ thuật Mật mã.")
    
    def get_model_path(self) -> str:
        """
        Lấy đường dẫn đến mô hình đang hoạt động.
        
        Returns:
            str: Đường dẫn đến mô hình.
        """
        active_model = self.get_active_model()
        if active_model:
            return active_model.get("path", os.environ.get("DEFAULT_MODEL_PATH", "NousResearch/Hermes-2-Pro-Llama-3-8B"))
        return os.environ.get("DEFAULT_MODEL_PATH", "NousResearch/Hermes-2-Pro-Llama-3-8B")
    
    def get_model_type(self) -> str:
        """
        Lấy loại của mô hình đang hoạt động.
        
        Returns:
            str: Loại mô hình (huggingface, ollama, gemini, other)
        """
        active_model = self.get_active_model()
        if active_model:
            return active_model.get("modelType", ModelType.HUGGINGFACE)
        return os.environ.get("DEFAULT_MODEL_TYPE", ModelType.HUGGINGFACE)
    
    def get_gemini_info(self) -> Dict[str, Any]:
        """
        Lấy thông tin cấu hình cho Gemini.
        
        Returns:
            Dict[str, Any]: Thông tin cấu hình Gemini.
        """
        active_model = self.get_active_model()
        if active_model and active_model.get("modelType") == ModelType.GEMINI:
            return {
                "api_key": active_model.get("api_key", os.environ.get("GEMINI_API_KEY", "")),
                "model": active_model.get("gemini_model", os.environ.get("DEFAULT_GEMINI_MODEL", "gemini-1.5-pro"))
            }
        return {
            "api_key": os.environ.get("GEMINI_API_KEY", ""),
            "model": os.environ.get("DEFAULT_GEMINI_MODEL", "gemini-1.5-pro")
        }
    
    def get_ollama_info(self) -> Dict[str, Any]:
        """
        Lấy thông tin cấu hình cho Ollama.
        
        Returns:
            Dict[str, Any]: Thông tin cấu hình Ollama.
        """
        active_model = self.get_active_model()
        if active_model and active_model.get("modelType") == ModelType.OLLAMA:
            return {
                "model": active_model.get("ollama_model", os.environ.get("DEFAULT_OLLAMA_MODEL", "llama3")),
                "url": active_model.get("ollama_url", os.environ.get("OLLAMA_API_URL", "http://localhost:11434"))
            }
        return {
            "model": os.environ.get("DEFAULT_OLLAMA_MODEL", "llama3"),
            "url": os.environ.get("OLLAMA_API_URL", "http://localhost:11434")
        }
    
    def get_huggingface_info(self) -> Dict[str, Any]:
        """
        Lấy thông tin cấu hình cho Hugging Face.
        
        Returns:
            Dict[str, Any]: Thông tin cấu hình Hugging Face.
        """
        active_model = self.get_active_model()
        if active_model and active_model.get("modelType") == ModelType.HUGGINGFACE:
            return {
                "model": active_model.get("path", os.environ.get("DEFAULT_MODEL_PATH", "NousResearch/Hermes-2-Pro-Llama-3-8B")),
                "token": active_model.get("hf_token", os.environ.get("HF_TOKEN", ""))
            }
        return {
            "model": os.environ.get("DEFAULT_MODEL_PATH", "NousResearch/Hermes-2-Pro-Llama-3-8B"),
            "token": os.environ.get("HF_TOKEN", "")
        }
    
    def get_temperature(self) -> float:
        """
        Lấy giá trị temperature từ mô hình đang hoạt động.
        
        Returns:
            float: Giá trị temperature.
        """
        return self.get_model_parameter("temperature", 0.7)
    
    def get_max_tokens(self) -> int:
        """
        Lấy giá trị max_tokens từ mô hình đang hoạt động.
        
        Returns:
            int: Giá trị max_tokens.
        """
        return self.get_model_parameter("max_tokens", 2048)
    
    # ============ RUNTIME MODEL SWITCHING METHODS ============
    
    def set_active_model_type(self, model_type: ModelType) -> None:
        """
        Đặt loại model đang hoạt động (runtime override).
        
        Args:
            model_type: Loại model cần kích hoạt
        """
        self._runtime_model_type = model_type
        # Clear cache để force reload
        self._active_model = None
        self._active_model_params = None
        print(f"🔄 Runtime model type set to: {model_type}")
    
    def set_ollama_model(self, ollama_model: str) -> None:
        """
        Đặt model Ollama cụ thể (runtime override).
        
        Args:
            ollama_model: Tên model Ollama
        """
        self._runtime_ollama_model = ollama_model
        if self._runtime_model_type != ModelType.OLLAMA:
            self.set_active_model_type(ModelType.OLLAMA)
        print(f"🔄 Runtime Ollama model set to: {ollama_model}")
    
    def set_gemini_model(self, gemini_model: str) -> None:
        """
        Đặt model Gemini cụ thể (runtime override).
        
        Args:
            gemini_model: Tên model Gemini
        """
        self._runtime_gemini_model = gemini_model
        if self._runtime_model_type != ModelType.GEMINI:
            self.set_active_model_type(ModelType.GEMINI)
        print(f"🔄 Runtime Gemini model set to: {gemini_model}")
    
    def get_model_type(self) -> ModelType:
        """
        Lấy loại model đang hoạt động (có thể là runtime override).
        
        Returns:
            ModelType: Loại model đang hoạt động
        """
        # Ưu tiên runtime override
        if self._runtime_model_type:
            return self._runtime_model_type
        
        # Fallback về environment variable
        if os.getenv("ACTIVE_MODEL_TYPE"):
            return ModelType(os.getenv("ACTIVE_MODEL_TYPE"))
        
        # Fallback về database hoặc default
        active_model = self.get_active_model()
        return ModelType(active_model.get("modelType", ModelType.GEMINI))
    
    def get_ollama_info(self) -> Dict[str, Any]:
        """
        Lấy thông tin Ollama đang hoạt động (có thể là runtime override).
        
        Returns:
            Dict[str, Any]: Thông tin Ollama
        """
        # Ưu tiên runtime override
        if self._runtime_ollama_model:
            return {
                "model": self._runtime_ollama_model,
                "url": os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
            }
        
        # Ưu tiên environment variable
        if os.getenv("ACTIVE_OLLAMA_MODEL"):
            return {
                "model": os.getenv("ACTIVE_OLLAMA_MODEL"),
                "url": os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
            }
        
        # Fallback về RAG_MODEL từ env
        return {
            "model": os.getenv("RAG_MODEL", "qwen3:8b"),
            "url": os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
        }
    
    def get_gemini_info(self) -> Dict[str, Any]:
        """
        Lấy thông tin Gemini đang hoạt động (có thể là runtime override).
        
        Returns:
            Dict[str, Any]: Thông tin Gemini
        """
        # Ưu tiên runtime override
        if self._runtime_gemini_model:
            return {
                "model": self._runtime_gemini_model,
                "api_key": os.getenv("GOOGLE_API_KEY", "")
            }
        
        # Ưu tiên environment variable
        if os.getenv("ACTIVE_GEMINI_MODEL"):
            return {
                "model": os.getenv("ACTIVE_GEMINI_MODEL"),
                "api_key": os.getenv("GOOGLE_API_KEY", "")
            }
        
        # Fallback về GEMINI_MODEL từ env
        return {
            "model": os.getenv("GEMINI_MODEL", "gemini-2.0-flash"),
            "api_key": os.getenv("GOOGLE_API_KEY", "")
        }
    
    def clear_runtime_overrides(self) -> None:
        """
        Xóa tất cả runtime overrides và trở về cấu hình mặc định.
        """
        self._runtime_model_type = None
        self._runtime_ollama_model = None
        self._runtime_gemini_model = None
        self._active_model = None
        self._active_model_params = None
        print("🔄 Runtime overrides cleared")

# Singleton instance
model_manager = ModelManager()
