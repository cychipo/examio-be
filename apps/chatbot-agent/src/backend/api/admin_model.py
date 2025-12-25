"""
Admin Model Management API
Provides endpoints for administrators to manage Ollama and Gemini models.
"""
import os
import asyncio
import httpx
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException, Depends, status, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from subprocess import run, PIPE, CalledProcessError

import sys
sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..'))

from llm.model_manager import model_manager, ModelType
from llm.llm_factory import LLMFactory
from ..auth.dependencies import get_current_admin_user
from ..models.responses import BaseResponse

router = APIRouter(tags=["Admin Model Management"])
security = HTTPBearer()

# ============ PYDANTIC MODELS ============

class ModelSelectionRequest(BaseModel):
    model_type: str  # "ollama" or "gemini"
    model_name: str

class ModelTestRequest(BaseModel):
    model_type: str  # "ollama" or "gemini"
    model_name: str
    test_message: str = "Hello, this is a test message."

class OllamaModel(BaseModel):
    name: str
    size: str
    modified: str
    digest: Optional[str] = None
    details: Optional[Dict[str, Any]] = None

class GeminiModel(BaseModel):
    name: str
    display_name: str
    description: Optional[str] = None
    supported_generation_methods: Optional[List[str]] = None

class AvailableModelsResponse(BaseModel):
    ollama_models: List[OllamaModel]
    gemini_models: List[GeminiModel]
    current_active: Dict[str, Any]

# ============ HELPER FUNCTIONS ============

async def get_ollama_models() -> List[Dict[str, Any]]:
    """
    Lấy danh sách models đã pull từ Ollama.
    
    Returns:
        List[Dict[str, Any]]: Danh sách Ollama models
    """
    try:
        ollama_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
        
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{ollama_url}/api/tags", timeout=10.0)
            
            if response.status_code == 200:
                data = response.json()
                models = []
                
                for model in data.get("models", []):
                    # Convert size from int to string if needed
                    size_value = model.get("size", "")
                    if isinstance(size_value, int):
                        size_value = str(size_value)
                    
                    models.append({
                        "name": model.get("name", ""),
                        "size": size_value,
                        "modified": model.get("modified_at", ""),
                        "digest": model.get("digest", ""),
                        "details": model.get("details", {})
                    })
                
                return models
            else:
                print(f"❌ Failed to fetch Ollama models: {response.status_code}")
                return []
                
    except Exception as e:
        print(f"❌ Error fetching Ollama models: {e}")
        return []

def get_gemini_models() -> List[Dict[str, Any]]:
    """
    Lấy danh sách models có sẵn từ Gemini API.
    
    Returns:
        List[Dict[str, Any]]: Danh sách Gemini models
    """
    # Danh sách các model Gemini có sẵn (static list)
    return [
        {
            "name": "gemini-2.0-flash",
            "display_name": "Gemini 2.0 Flash",
            "description": "Latest Gemini model with improved performance",
            "supported_generation_methods": ["generateContent", "streamGenerateContent"]
        },
        {
            "name": "gemini-1.5-pro",
            "display_name": "Gemini 1.5 Pro",
            "description": "High-performance model for complex tasks",
            "supported_generation_methods": ["generateContent", "streamGenerateContent"]
        },
        {
            "name": "gemini-1.5-flash",
            "display_name": "Gemini 1.5 Flash",
            "description": "Fast model for quick responses",
            "supported_generation_methods": ["generateContent", "streamGenerateContent"]
        },
        {
            "name": "gemini-pro",
            "display_name": "Gemini Pro",
            "description": "General-purpose model",
            "supported_generation_methods": ["generateContent", "streamGenerateContent"]
        }
    ]

async def test_model_connection(model_type: str, model_name: str, test_message: str) -> Dict[str, Any]:
    """
    Test connection to a specific model.
    
    Args:
        model_type: "ollama" or "gemini"
        model_name: Name of the model to test
        test_message: Test message to send
        
    Returns:
        Dict[str, Any]: Test result
    """
    try:
        # Temporarily set the model for testing
        original_type = model_manager.get_model_type()
        
        if model_type.lower() == "ollama":
            model_manager.set_ollama_model(model_name)
        elif model_type.lower() == "gemini":
            model_manager.set_gemini_model(model_name)
        else:
            return {"success": False, "error": f"Unsupported model type: {model_type}"}
        
        # Create LLM instance and test
        llm = LLMFactory.create_llm()
        response = await llm.ainvoke(test_message)
        
        # Restore original model type
        if original_type == ModelType.OLLAMA:
            model_manager.set_active_model_type(ModelType.OLLAMA)
        elif original_type == ModelType.GEMINI:
            model_manager.set_active_model_type(ModelType.GEMINI)
        
        return {
            "success": True,
            "response": response.content if hasattr(response, 'content') else str(response),
            "model_type": model_type,
            "model_name": model_name
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "model_type": model_type,
            "model_name": model_name
        }

# ============ API ENDPOINTS ============

@router.get("/available", response_model=AvailableModelsResponse, dependencies=[Depends(security)])
async def get_available_models(
    admin_user: dict = Depends(get_current_admin_user)
):
    """
    Lấy danh sách tất cả models có sẵn từ Ollama và Gemini.
    
    Returns:
        AvailableModelsResponse: Danh sách models và model đang hoạt động
    """
    try:
        # Lấy models từ Ollama và Gemini
        ollama_models = await get_ollama_models()
        gemini_models = get_gemini_models()
        
        # Lấy thông tin model đang hoạt động
        current_type = model_manager.get_model_type()
        current_active = {
            "model_type": current_type.value,
        }
        
        if current_type == ModelType.OLLAMA:
            ollama_info = model_manager.get_ollama_info()
            current_active.update({
                "model_name": ollama_info["model"],
                "url": ollama_info["url"]
            })
        elif current_type == ModelType.GEMINI:
            gemini_info = model_manager.get_gemini_info()
            current_active.update({
                "model_name": gemini_info["model"],
                "api_key_configured": bool(gemini_info["api_key"])
            })
        
        # Convert to Pydantic models with error handling
        print(f"🔍 Ollama models data: {ollama_models}")
        print(f"🔍 Gemini models data: {gemini_models}")
        
        try:
            ollama_model_objects = [OllamaModel(**model) for model in ollama_models]
            print(f"✅ Ollama models converted successfully")
        except Exception as e:
            print(f"❌ Error converting Ollama models: {e}")
            raise
        
        try:
            gemini_model_objects = [GeminiModel(**model) for model in gemini_models]
            print(f"✅ Gemini models converted successfully")
        except Exception as e:
            print(f"❌ Error converting Gemini models: {e}")
            raise
        
        return AvailableModelsResponse(
            ollama_models=ollama_model_objects,
            gemini_models=gemini_model_objects,
            current_active=current_active
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch available models: {str(e)}"
        )

@router.post("/select", dependencies=[Depends(security)])
async def select_model(
    request: ModelSelectionRequest,
    admin_user: dict = Depends(get_current_admin_user)
):
    """
    Chọn model để sử dụng cho hệ thống.
    
    Args:
        request: ModelSelectionRequest với model_type và model_name
        
    Returns:
        BaseResponse: Kết quả của việc chọn model
    """
    try:
        model_type = request.model_type.lower()
        model_name = request.model_name
        
        if model_type == "ollama":
            # Kiểm tra xem model có tồn tại trong Ollama không
            ollama_models = await get_ollama_models()
            available_models = [m["name"] for m in ollama_models]
            
            if model_name not in available_models:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Ollama model '{model_name}' not found. Available models: {available_models}"
                )
            
            model_manager.set_ollama_model(model_name)
            
        elif model_type == "gemini":
            # Kiểm tra xem model có tồn tại trong Gemini không
            gemini_models = get_gemini_models()
            available_models = [m["name"] for m in gemini_models]
            
            if model_name not in available_models:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Gemini model '{model_name}' not found. Available models: {available_models}"
                )
            
            # Kiểm tra API key
            if not os.getenv("GOOGLE_API_KEY"):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Google API key not configured"
                )
            
            model_manager.set_gemini_model(model_name)
            
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported model type: {model_type}. Supported types: ollama, gemini"
            )
        
        return BaseResponse(
            success=True,
            message=f"Successfully selected {model_type} model: {model_name}",
            data={
                "model_type": model_type,
                "model_name": model_name,
                "timestamp": "now"
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to select model: {str(e)}"
        )

@router.get("/current", dependencies=[Depends(security)])
async def get_current_model(
    admin_user: dict = Depends(get_current_admin_user)
):
    """
    Lấy thông tin về model đang được sử dụng.
    
    Returns:
        Dict: Thông tin model hiện tại
    """
    try:
        current_type = model_manager.get_model_type()
        
        result = {
            "model_type": current_type.value,
            "timestamp": "now"
        }
        
        if current_type == ModelType.OLLAMA:
            ollama_info = model_manager.get_ollama_info()
            result.update({
                "model_name": ollama_info["model"],
                "url": ollama_info["url"]
            })
        elif current_type == ModelType.GEMINI:
            gemini_info = model_manager.get_gemini_info()
            result.update({
                "model_name": gemini_info["model"],
                "api_key_configured": bool(gemini_info["api_key"])
            })
        
        return BaseResponse(
            success=True,
            message="Current model information",
            data=result
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get current model: {str(e)}"
        )

@router.post("/test", dependencies=[Depends(security)])
async def test_model(
    request: ModelTestRequest,
    admin_user: dict = Depends(get_current_admin_user)
):
    """
    Test kết nối đến một model cụ thể.
    
    Args:
        request: ModelTestRequest với thông tin test
        
    Returns:
        BaseResponse: Kết quả test
    """
    try:
        result = await test_model_connection(
            request.model_type,
            request.model_name,
            request.test_message
        )
        
        if result["success"]:
            return BaseResponse(
                success=True,
                message=f"Model test successful for {request.model_type}:{request.model_name}",
                data=result
            )
        else:
            return BaseResponse(
                success=False,
                message=f"Model test failed for {request.model_type}:{request.model_name}",
                data=result
            )
            
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to test model: {str(e)}"
        )

@router.post("/reset", dependencies=[Depends(security)])
async def reset_to_default(
    admin_user: dict = Depends(get_current_admin_user)
):
    """
    Reset về cấu hình model mặc định.
    
    Returns:
        BaseResponse: Kết quả reset
    """
    try:
        model_manager.clear_runtime_overrides()
        
        return BaseResponse(
            success=True,
            message="Successfully reset to default model configuration",
            data={
                "message": "All runtime overrides cleared",
                "timestamp": "now"
            }
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to reset model configuration: {str(e)}"
        )