from fastapi import APIRouter, HTTPException, status, Depends, Body
from typing import List, Dict, Any, Optional
from bson.objectid import ObjectId
from datetime import datetime
from enum import Enum

from backend.models.responses import BaseResponse
from backend.auth.dependencies import require_auth
from backend.db.mongodb import mongodb

class ModelType(str, Enum):
    HUGGINGFACE = "huggingface"
    OLLAMA = "ollama"
    GEMINI = "gemini"
    OTHER = "other"

router = APIRouter()

@router.get("/", response_model=BaseResponse)
async def get_all_models(current_user: dict = Depends(require_auth)):
    """
    Lấy danh sách tất cả các mô hình LLM có sẵn
    """
    try:
        # Lấy danh sách models từ database
        models = await mongodb.db.llm_models.find().to_list(length=None)
        
        # Chuyển đổi ObjectId thành string cho response
        for model in models:
            model["id"] = str(model["_id"])
            del model["_id"]
        
        return BaseResponse(
            statusCode=status.HTTP_200_OK,
            message="Lấy danh sách mô hình thành công",
            data=models
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Lỗi khi lấy danh sách mô hình: {str(e)}"
        )

@router.get("/active", response_model=BaseResponse)
async def get_active_model(current_user: dict = Depends(require_auth)):
    """
    Lấy thông tin về mô hình đang hoạt động
    """
    try:
        # Tìm model đang hoạt động (isActive = True)
        active_model = await mongodb.db.llm_models.find_one({"isActive": True})
        
        if not active_model:
            return BaseResponse(
                statusCode=status.HTTP_404_NOT_FOUND,
                message="Không có mô hình nào đang hoạt động",
                data=None
            )
        
        # Chuyển đổi ObjectId thành string
        active_model["id"] = str(active_model["_id"])
        del active_model["_id"]
        
        return BaseResponse(
            statusCode=status.HTTP_200_OK,
            message="Lấy thông tin mô hình đang hoạt động thành công",
            data=active_model
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Lỗi khi lấy thông tin mô hình đang hoạt động: {str(e)}"
        )

@router.post("/activate/{model_id}", response_model=BaseResponse)
async def activate_model(
    model_id: str,
    current_user: dict = Depends(require_auth)
):
    """
    Kích hoạt một mô hình cụ thể và vô hiệu hóa tất cả các mô hình khác
    """
    # Kiểm tra quyền admin
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Chỉ admin mới có quyền kích hoạt mô hình"
        )
    
    try:
        # Kiểm tra xem model có tồn tại không
        model_to_activate = await mongodb.db.llm_models.find_one({"_id": ObjectId(model_id)})
        
        if not model_to_activate:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Không tìm thấy mô hình"
            )
        
        # Vô hiệu hóa tất cả các mô hình
        await mongodb.db.llm_models.update_many(
            {},
            {"$set": {"isActive": False}}
        )
        
        # Kích hoạt mô hình được chỉ định
        await mongodb.db.llm_models.update_one(
            {"_id": ObjectId(model_id)},
            {
                "$set": {
                    "isActive": True,
                    "lastUsed": datetime.utcnow()
                }
            }
        )
        
        return BaseResponse(
            statusCode=status.HTTP_200_OK,
            message=f"Đã kích hoạt mô hình {model_to_activate.get('name')}",
            data={"id": model_id}
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Lỗi khi kích hoạt mô hình: {str(e)}"
        )

@router.put("/params/{model_id}", response_model=BaseResponse)
async def update_model_params(
    model_id: str,
    params: Dict[str, Any] = Body(...),
    current_user: dict = Depends(require_auth)
):
    """
    Cập nhật tham số cho một mô hình cụ thể
    """
    # Kiểm tra quyền admin
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Chỉ admin mới có quyền cập nhật tham số mô hình"
        )
    
    try:
        # Kiểm tra xem model có tồn tại không
        model = await mongodb.db.llm_models.find_one({"_id": ObjectId(model_id)})
        
        if not model:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Không tìm thấy mô hình"
            )
        
        # Cập nhật tham số
        await mongodb.db.llm_models.update_one(
            {"_id": ObjectId(model_id)},
            {"$set": {"parameters": params}}
        )
        
        return BaseResponse(
            statusCode=status.HTTP_200_OK,
            message="Cập nhật tham số mô hình thành công",
            data={"id": model_id}
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Lỗi khi cập nhật tham số mô hình: {str(e)}"
        )

@router.post("/upload", response_model=BaseResponse)
async def upload_model(
    model_data: Dict[str, Any] = Body(...),
    current_user: dict = Depends(require_auth)
):
    """
    Tải lên một mô hình mới
    """
    # Kiểm tra quyền admin
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Chỉ admin mới có quyền tải lên mô hình mới"
        )
    
    try:
        # Tạo model mới với các giá trị mặc định
        now = datetime.utcnow()
        
        # Xác định loại model
        model_type = model_data.get("modelType", ModelType.OTHER)
        
        # Tạo cấu trúc model tùy thuộc vào loại
        new_model = {
            "name": model_data.get("name"),
            "description": model_data.get("description", ""),
            "path": model_data.get("path", ""),
            "size": model_data.get("size", "N/A"),
            "modelType": model_type,
            "uploadDate": now,
            "lastUsed": None,
            "isActive": False,
            "parameters": {
                "temperature": 0.7,
                "top_p": 0.9,
                "top_k": 40,
                "max_tokens": 2048,
                "presence_penalty": 0,
                "frequency_penalty": 0,
                "system_prompt": ""
            },
            "stats": {
                "averageResponseTime": 0,
                "usageCount": 0,
                "tokensGenerated": 0
            }
        }
        
        # Thêm thông tin đặc thù cho từng loại model
        if model_type == ModelType.GEMINI:
            new_model["api_key"] = model_data.get("api_key", "")
            new_model["gemini_model"] = model_data.get("gemini_model", "gemini-1.5-pro")
        elif model_type == ModelType.OLLAMA:
            new_model["ollama_model"] = model_data.get("ollama_model", "")
            new_model["ollama_url"] = model_data.get("ollama_url", "http://localhost:11434")
        elif model_type == ModelType.HUGGINGFACE:
            new_model["hf_token"] = model_data.get("hf_token", "")
        
        # Chèn model mới vào database
        result = await mongodb.db.llm_models.insert_one(new_model)
        
        return BaseResponse(
            statusCode=status.HTTP_201_CREATED,
            message="Tải lên mô hình thành công",
            data={"id": str(result.inserted_id)}
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Lỗi khi tải lên mô hình: {str(e)}"
        )
