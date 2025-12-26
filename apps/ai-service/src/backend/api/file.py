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
import uuid
from typing import Dict, Any, List
from datetime import datetime

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field

# Add the parent directory to sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from rag.retriever import extract_text_from_file, create_in_memory_retriever
from rag.simple_chat_agent import SimpleChatAgent
from rag.vector_store_pg import get_pg_vector_store
from backend.services.ocr_service import ocr_service

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter()

# Cache retrievers in memory for faster queries
_retriever_cache: Dict[str, Any] = {}


# ==================== Request Models ====================

class ProcessFileRequest(BaseModel):
    """Request từ NestJS để OCR file đã upload"""
    user_storage_id: str = Field(..., description="ID của UserStorage (NestJS đã tạo)")


class QueryFileRequest(BaseModel):
    """Request để query file"""
    user_storage_id: str = Field(..., description="ID của UserStorage")
    query: str = Field(..., description="Câu hỏi về nội dung file")


class MultiQueryRequest(BaseModel):
    """Request để query nhiều câu hỏi"""
    user_storage_id: str = Field(..., description="ID của UserStorage")
    queries: List[str] = Field(..., description="Danh sách câu hỏi")


# ==================== Helper Functions ====================

async def get_or_create_retriever(user_storage_id: str):
    """Get retriever from cache or create from DB chunks"""
    if user_storage_id in _retriever_cache:
        return _retriever_cache[user_storage_id]

    chunks = await ocr_service.get_document_chunks(user_storage_id)
    if not chunks:
        return None

    combined_content = "\n\n".join([c.content for c in chunks])
    retriever, _ = create_in_memory_retriever(combined_content)
    _retriever_cache[user_storage_id] = retriever
    return retriever


# ==================== API Endpoints ====================

@router.post("/process-file", response_model=Dict[str, Any])
async def process_file(request: ProcessFileRequest):
    """
    OCR và tạo embeddings cho file đã upload bởi NestJS

    Flow:
    1. NestJS upload file lên R2, tạo UserStorage với status=PENDING
    2. NestJS gọi API này với userStorageId
    3. Python download từ R2, OCR, lưu embeddings
    4. Update status = COMPLETED
    """
    try:
        user_storage_id = request.user_storage_id
        logger.info(f"Processing file: {user_storage_id}")

        # Get file info from DB (created by NestJS)
        file_info = await ocr_service.get_file_info(user_storage_id)
        if not file_info:
            raise HTTPException(status_code=404, detail="File not found in UserStorage")

        # Check if already processed
        if file_info.processing_status == "COMPLETED":
            chunks = await ocr_service.get_document_chunks(user_storage_id)
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
            # Download file from R2
            logger.info(f"Downloading file from R2: {file_info.url}")
            _, temp_path = await ocr_service.download_file_from_r2(file_info.url)

            # OCR file
            file_content = extract_text_from_file(temp_path, file_info.mimetype)

            # Cleanup temp file
            if os.path.exists(temp_path):
                os.unlink(temp_path)

            if file_content.startswith("Error") or file_content.startswith("Unsupported"):
                await ocr_service.update_processing_status(user_storage_id, "FAILED")
                raise HTTPException(status_code=400, detail=file_content)

            # Create chunks
            retriever, chunks = create_in_memory_retriever(file_content)

            # Store each chunk with embeddings
            pg_store = get_pg_vector_store()
            stored_count = 0

            for i, chunk in enumerate(chunks):
                chunk_id = f"{user_storage_id}_chunk_{i}"
                page = getattr(chunk, 'metadata', {}).get('page', str(i + 1))

                success = await pg_store.store_document(
                    doc_id=chunk_id,
                    user_storage_id=user_storage_id,
                    content=chunk.page_content,
                    page_range=str(page),
                    title=file_info.filename
                )
                if success:
                    stored_count += 1

            # Update status to COMPLETED
            await ocr_service.update_processing_status(user_storage_id, "COMPLETED", credit_charged=True)

            # Cache retriever
            _retriever_cache[user_storage_id] = retriever

            logger.info(f"File processed successfully: {user_storage_id}, {stored_count} chunks")

            return {
                "success": True,
                "cached": False,
                "message": "OCR và lưu embeddings thành công",
                "chunks_count": stored_count,
                "user_storage_id": user_storage_id
            }

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

        # Vector search
        pg_store = get_pg_vector_store()
        similar_docs = await pg_store.search_similar([user_storage_id], query, top_k=5)

        if not similar_docs:
            return {
                "success": True,
                "answer": "Không tìm thấy nội dung liên quan trong file.",
                "sources": [],
                "user_storage_id": user_storage_id
            }

        # Get retriever for agent
        retriever = await get_or_create_retriever(user_storage_id)
        if not retriever:
            raise HTTPException(status_code=500, detail="Không thể tạo retriever")

        # Use agent to answer
        agent = SimpleChatAgent(custom_retriever=retriever)
        answer = agent.chat(query)

        sources = [{"content": doc.content[:500], "page": doc.page_range, "score": doc.similarity_score}
                   for doc in similar_docs[:3]]

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

        retriever = await get_or_create_retriever(user_storage_id)
        if not retriever:
            raise HTTPException(status_code=500, detail="Không thể tạo retriever")

        agent = SimpleChatAgent(custom_retriever=retriever)
        pg_store = get_pg_vector_store()

        results = []
        for query in queries:
            answer = agent.chat(query)
            similar_docs = await pg_store.search_similar([user_storage_id], query, top_k=2)

            results.append({
                "query": query,
                "answer": answer,
                "sources": [doc.content[:300] for doc in similar_docs]
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
        "chunks_count": len(chunks)
    }


@router.delete("/clear-cache/{user_storage_id}")
async def clear_retriever_cache(user_storage_id: str):
    """Clear retriever cache for a file"""
    if user_storage_id in _retriever_cache:
        del _retriever_cache[user_storage_id]
        return {"success": True, "message": "Cache cleared"}
    return {"success": True, "message": "No cache to clear"}
