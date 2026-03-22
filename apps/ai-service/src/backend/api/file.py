"""
AI Processing API - OCR và Vector Search

API này CHỈ xử lý AI tasks:
- OCR files đã upload bởi NestJS
- Vector similarity search
- Query files với context

KHÔNG xử lý: Upload file, tạo UserStorage (NestJS làm)
"""
import logging
import os
import sys
from typing import Dict, Any, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, ConfigDict

# Add the parent directory to sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from src.rag.retriever import create_in_memory_retriever
from src.rag.simple_chat_agent import SimpleChatAgent
from src.backend.services.hybrid_retrieval_service import hybrid_retrieval_service
from src.backend.services.ocr_service import (
    ocr_service,
    FileExtractionError,
    NoContentExtractedError,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter()

# Cache retrievers in memory for faster queries
_retriever_cache: Dict[str, Any] = {}

# ==================== Request Models ====================

class ProcessFileRequest(BaseModel):
    """Request từ NestJS để OCR file đã upload"""
    model_config = ConfigDict(populate_by_name=True)
    
    user_storage_id: str = Field(..., description="ID của UserStorage (NestJS đã tạo)")
    model_type: str = Field(default="fayedark", alias="modelType", description="AI model: 'gemini' or 'fayedark' (Ollama)")


class QueryFileRequest(BaseModel):
    """Request để query file"""
    model_config = ConfigDict(populate_by_name=True)
    
    user_storage_id: str = Field(..., description="ID của UserStorage")
    query: str = Field(..., description="Câu hỏi về nội dung file")
    model_type: Optional[str] = Field(default=None, alias="modelType", description="AI model type")


class MultiQueryRequest(BaseModel):
    """Request để query nhiều câu hỏi"""
    model_config = ConfigDict(populate_by_name=True)
    
    user_storage_id: str = Field(..., description="ID của UserStorage")
    queries: List[str] = Field(..., description="Danh sách câu hỏi")
    model_type: Optional[str] = Field(default=None, alias="modelType", description="AI model type")


# ==================== Helper Functions ====================

async def get_or_create_retriever(user_storage_id: str, model_type: str = "gemini"):
    """Get retriever from cache or create from DB chunks"""
    cache_key = f"{user_storage_id}:{model_type}"
    if cache_key in _retriever_cache:
        return _retriever_cache[cache_key]

    chunks = await ocr_service.get_document_chunks(user_storage_id)
    if not chunks:
        return None

    combined_content = "\n\n".join([c.content for c in chunks])
    retriever, _ = create_in_memory_retriever(combined_content, model_type=model_type)
    _retriever_cache[cache_key] = retriever
    return retriever


def clear_cached_retriever(user_storage_id: str):
    for cache_key in list(_retriever_cache.keys()):
        if cache_key.startswith(f"{user_storage_id}:"):
            _retriever_cache.pop(cache_key, None)
    hybrid_retrieval_service.clear_graph_state(user_storage_id)


async def clear_graph_db_state(user_storage_id: str):
    from src.backend.services.graph_storage_service import graph_storage_service

    await graph_storage_service.delete_graph_state(user_storage_id)


# ==================== API Endpoints ====================

@router.post("/process-file", response_model=Dict[str, Any])
async def process_file(request: ProcessFileRequest):
    """
    OCR và tạo embeddings cho file đã upload bởi NestJS
    
    Flow:
    1. NestJS upload file lên R2, tạo UserStorage với status=PENDING
    2. NestJS gọi API này với userStorageId
    3. Python download từ R2
    4. Xử lý OCR và trích xuất text (Fallback sang Tesseract cho bản scan)
    5. Tạo embedding cho mỗi chunk và lưu vào Document table
    6. Update status = COMPLETED
    """
    try:
        user_storage_id = request.user_storage_id
        model_type = request.model_type
        logger.info(f"Processing file: {user_storage_id} with model: {model_type}")

        # Get file info from DB (created by NestJS)
        file_info = await ocr_service.get_file_info(user_storage_id)
        if not file_info:
            raise HTTPException(status_code=404, detail="File not found in UserStorage")

        # Check if already processed
        if file_info.processing_status == "COMPLETED":
            chunks = await ocr_service.get_document_chunks(user_storage_id)
            clear_cached_retriever(user_storage_id)
            logger.info(f"File already processed: {user_storage_id}, {len(chunks)} chunks")
            return {
                "success": True,
                "cached": True,
                "message": "File đã được OCR trước đó",
                "chunks_count": len(chunks),
                "user_storage_id": user_storage_id
            }

        # Update status to PROCESSING
        await ocr_service.update_processing_status(user_storage_id, "PROCESSING")

        try:
            from src.rag.vector_store_pg import get_pg_vector_store

            pg_store = get_pg_vector_store()
            documents_to_store = await ocr_service.prepare_documents_to_store(
                user_storage_id=user_storage_id,
                file_info=file_info,
            )

            logger.info(f"📦 Storing {len(documents_to_store)} text chunks...")
            stored_count = await pg_store.store_documents_batch(documents_to_store, model_type=model_type)

            if stored_count == 0:
                raise NoContentExtractedError("No content could be extracted from file")

            await ocr_service.update_processing_status(user_storage_id, "COMPLETED", credit_charged=True)
            clear_cached_retriever(user_storage_id)

            logger.info(f"✅ File processed successfully: {user_storage_id}, {stored_count} chunks")

            return {
                "success": True,
                "cached": False,
                "message": "OCR và lưu embeddings thành công (Tesseract Fallback)",
                "chunks_count": stored_count,
                "user_storage_id": user_storage_id
            }

        except FileExtractionError as e:
            await ocr_service.update_processing_status(user_storage_id, "FAILED")
            raise HTTPException(status_code=400, detail=str(e))
        except NoContentExtractedError as e:
            await ocr_service.update_processing_status(user_storage_id, "FAILED")
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            await ocr_service.update_processing_status(user_storage_id, "FAILED")
            raise e
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error processing file: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error processing file: {str(e)}")


@router.post("/query-file", response_model=Dict[str, Any])
async def query_file(request: QueryFileRequest):
    """Query file content using vector search"""
    try:
        user_storage_id = request.user_storage_id
        query = request.query

        logger.info(f"Querying file: {user_storage_id}")

        # Check file exists and processed
        file_info = await ocr_service.get_file_info(user_storage_id)
        if not file_info:
            raise HTTPException(status_code=404, detail="File not found")

        if file_info.processing_status != "COMPLETED":
            raise HTTPException(status_code=400, detail=f"File chưa được xử lý: {file_info.processing_status}")

        # Determine model_type
        from src.llm.model_manager import model_manager, ModelType
        system_model_type = model_manager.get_model_type()
        requested_model = request.model_type
        
        # Consistent mapping: translate system ModelType to string id
        if not requested_model:
            requested_model = "fayedark" if system_model_type == ModelType.OLLAMA else "gemini"

        retrieval_result = await hybrid_retrieval_service.retrieve_for_chat(
            user_storage_id=user_storage_id,
            query=query,
            model_type=requested_model,
            top_k=5,
        )
        logger.info(
            "[AI_RETRIEVAL] mode=%s user_storage_id=%s selected=%s total=%s",
            retrieval_result.retrieval_mode,
            user_storage_id,
            retrieval_result.metadata.get("selected_chunks"),
            retrieval_result.metadata.get("total_chunks"),
        )

        if not retrieval_result.chunks:
            return {
                "success": True,
                "answer": "Không tìm thấy nội dung liên quan trong file.",
                "sources": [],
                "user_storage_id": user_storage_id
            }

        # Get retriever for agent
        retriever = await get_or_create_retriever(user_storage_id, model_type=requested_model)
        if not retriever:
            raise HTTPException(status_code=500, detail="Không thể tạo retriever")

        # Use agent to answer with consistent model_type
        agent = SimpleChatAgent(custom_retriever=retriever, model_type=requested_model)
        answer = agent.chat(query)

        sources = retrieval_result.sources

        return {
            "success": True,
            "answer": answer,
            "sources": sources,
            "user_storage_id": user_storage_id,
            "filename": file_info.filename
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error querying file: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error: {str(e)}")


@router.post("/multi-query", response_model=Dict[str, Any])
async def multi_query_file(request: MultiQueryRequest):
    """Query file với nhiều câu hỏi"""
    try:
        user_storage_id = request.user_storage_id
        queries = request.queries

        if not queries:
            raise HTTPException(status_code=400, detail="Không có câu hỏi")

        file_info = await ocr_service.get_file_info(user_storage_id)
        if not file_info:
            raise HTTPException(status_code=404, detail="File not found")

        if file_info.processing_status != "COMPLETED":
            raise HTTPException(status_code=400, detail=f"File chưa được xử lý")

        # Determine model_type
        from src.llm.model_manager import model_manager, ModelType
        system_model_type = model_manager.get_model_type()
        requested_model = request.model_type
        
        if not requested_model:
            requested_model = "fayedark" if system_model_type == ModelType.OLLAMA else "gemini"

        results = []
        for query in queries:
            retrieval_result = await hybrid_retrieval_service.retrieve_for_chat(
                user_storage_id=user_storage_id,
                query=query,
                model_type=requested_model,
                top_k=5,
            )
            logger.info(
                "[AI_RETRIEVAL] mode=%s user_storage_id=%s selected=%s total=%s multi_query=true",
                retrieval_result.retrieval_mode,
                user_storage_id,
                retrieval_result.metadata.get("selected_chunks"),
                retrieval_result.metadata.get("total_chunks"),
            )

            retriever = None
            if retrieval_result.combined_context:
                retriever, _ = create_in_memory_retriever(
                    retrieval_result.combined_context,
                    model_type=requested_model,
                )

            agent = SimpleChatAgent(
                custom_retriever=retriever,
                model_type=requested_model,
                pre_context=retrieval_result.combined_context,
            )
            answer = agent.chat(query)

            results.append({
                "query": query,
                "answer": answer,
                "sources": retrieval_result.sources,
            })

        return {
            "success": True,
            "results": results,
            "user_storage_id": user_storage_id,
            "filename": file_info.filename
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in multi-query: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/file-status/{user_storage_id}", response_model=Dict[str, Any])
async def get_file_status(user_storage_id: str):
    """Get file processing status"""
    file_info = await ocr_service.get_file_info(user_storage_id)

    if not file_info:
        raise HTTPException(status_code=404, detail="File not found")

    chunks = await ocr_service.get_document_chunks(user_storage_id)

    return {
        "success": True,
        "user_storage_id": user_storage_id,
        "filename": file_info.filename,
        "processing_status": file_info.processing_status,
        "chunks_count": len(chunks),
        "graph_cache_path": None,
    }


@router.get("/graph-stats/{user_storage_id}", response_model=Dict[str, Any])
async def get_graph_stats(user_storage_id: str):
    """Get Hybrid GraphRAG stats for a processed file"""
    file_info = await ocr_service.get_file_info(user_storage_id)

    if not file_info:
        raise HTTPException(status_code=404, detail="File not found")

    stats = await hybrid_retrieval_service.get_graph_stats(user_storage_id)
    return {
        "success": True,
        "filename": file_info.filename,
        **stats,
    }


@router.delete("/clear-cache/{user_storage_id}")
async def clear_retriever_cache(user_storage_id: str):
    """Clear retriever cache for a file"""
    clear_cached_retriever(user_storage_id)
    await clear_graph_db_state(user_storage_id)
    return {"success": True, "message": "Cache cleared"}
