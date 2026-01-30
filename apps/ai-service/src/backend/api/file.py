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

from src.rag.retriever import extract_text_from_file, create_in_memory_retriever
from src.rag.simple_chat_agent import SimpleChatAgent
from src.rag.vector_store_pg import get_pg_vector_store
from src.backend.services.ocr_service import ocr_service

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter()

# Cache retrievers in memory for faster queries
_retriever_cache: Dict[str, Any] = {}


# ==================== Request Models ====================

class ProcessFileRequest(BaseModel):
    """Request từ NestJS để OCR file đã upload"""
    user_storage_id: str = Field(..., description="ID của UserStorage (NestJS đã tạo)")
    model_type: str = Field(default="gemini", alias="modelType", description="AI model: 'gemini' or 'fayedark'")

    class Config:
        populate_by_name = True


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

    Flow giống be-main:
    1. NestJS upload file lên R2, tạo UserStorage với status=PENDING
    2. NestJS gọi API này với userStorageId
    3. Python download từ R2
    4. Split PDF thành chunks (mỗi 10 pages)
    5. OCR mỗi chunk bằng Tesseract (hoặc extract text nếu PDF có text layer)
    6. Tạo embedding cho mỗi chunk và lưu vào Document table
    7. Update status = COMPLETED
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
            file_bytes, temp_path = await ocr_service.download_file_from_r2(file_info.url)

            # --- PREFER OLMOCR SERVICE ---
            try:
                logger.info("🚀 Attempting to use high-quality OLMOCR service...")
                import httpx
                OCR_SERVICE_URL = os.environ.get("OCR_SERVICE_URL", "http://localhost:8003")

                async with httpx.AsyncClient(timeout=600.0) as client:
                    # Send file to OCR service
                    files = {"file": (file_info.filename, file_bytes, file_info.mimetype)}
                    ocr_response = await client.post(f"{OCR_SERVICE_URL}/api/ocr/process", files=files)

                    if ocr_response.status_code == 200:
                        ocr_result = ocr_response.json()
                        if ocr_result.get("success"):
                            content = ocr_result.get("content")
                            page_count = ocr_result.get("page_count", 1)
                            method = ocr_result.get("method", "unknown")
                            logger.info(f"✅ OLMOCR Success (Method: {method}): {len(content)} chars")

                            # Split into chunks for vector storage
                            from langchain_text_splitters import RecursiveCharacterTextSplitter
                            text_splitter = RecursiveCharacterTextSplitter(chunk_size=2000, chunk_overlap=200)
                            text_chunks = text_splitter.split_text(content)

                            pg_store = get_pg_vector_store()
                            documents_to_store = []
                            for i, chunk_text in enumerate(text_chunks):
                                chunk_id = f"{user_storage_id}_chunk_{i}"
                                documents_to_store.append({
                                    'id': chunk_id,
                                    'user_storage_id': user_storage_id,
                                    'content': chunk_text,
                                    'page_range': f"{i+1}",
                                    'title': f"Chunk {i+1}"
                                })

                            stored_count = await pg_store.store_documents_batch(documents_to_store, model_type=model_type)

                            # Update status to COMPLETED
                            await ocr_service.update_processing_status(user_storage_id, "COMPLETED", credit_charged=True)

                            return {
                                "success": True,
                                "cached": False,
                                "message": f"OCR (via {method}) và lưu embeddings thành công",
                                "chunks_count": stored_count,
                                "user_storage_id": user_storage_id
                            }
                    else:
                        logger.warning(f"⚠️ OLMOCR service failed (Status {ocr_response.status_code}), falling back to Tesseract")
            except Exception as ocr_svc_err:
                logger.warning(f"⚠️ Could not reach OLMOCR service: {ocr_svc_err}. Falling back to Tesseract")

            # --- FALLBACK TO TESSERACT (OLD METHOD) ---
            # Import PDF OCR service
            from backend.services.pdf_ocr_service import pdf_ocr_service

            stored_count = 0
            pg_store = get_pg_vector_store()

            # Check file type
            is_pdf = file_info.mimetype == "application/pdf" or file_info.url.lower().endswith('.pdf')

            if is_pdf:
                # PDF: Split into chunks and process each chunk
                # Giống extractAndSavePdfChunks trong be-main
                logger.info("📄 Processing PDF with chunk splitting...")

                try:
                    # Process PDF with chunks (split + OCR each chunk)
                    chunk_results = pdf_ocr_service.process_pdf_with_chunks(file_bytes)

                    # Prepare documents for batch storage (sử dụng batch embedding)
                    documents_to_store = []
                    for chunk_index, chunk_text in chunk_results:
                        if not chunk_text or not chunk_text.strip():
                            logger.warning(f"⚠️ Empty OCR result for chunk {chunk_index}")
                            continue

                        chunk_id = f"{user_storage_id}_chunk_{chunk_index}"
                        documents_to_store.append({
                            'id': chunk_id,
                            'user_storage_id': user_storage_id,
                            'content': chunk_text,
                            'page_range': str(chunk_index),
                            'title': f"Chunk {chunk_index}"
                        })
                        logger.info(f"📝 Prepared chunk {chunk_index}: {len(chunk_text)} chars")

                    # Batch store với batch embedding (tối ưu rate limit)
                    if documents_to_store:
                        stored_count = await pg_store.store_documents_batch(documents_to_store, model_type=model_type)
                    else:
                        stored_count = 0

                except Exception as pdf_error:
                    logger.error(f"PDF processing failed: {pdf_error}")
                    # Fallback to simple text extraction
                    logger.info("Falling back to simple text extraction...")
                    file_content = extract_text_from_file(temp_path, file_info.mimetype)

                    if file_content and not file_content.startswith("Error"):
                        # Split into smaller chunks for embedding
                        from langchain_text_splitters import RecursiveCharacterTextSplitter
                        text_splitter = RecursiveCharacterTextSplitter(
                            chunk_size=2000,
                            chunk_overlap=200
                        )
                        text_chunks = text_splitter.split_text(file_content)

                        # Prepare for batch storage
                        documents_to_store = []
                        for i, chunk_text in enumerate(text_chunks):
                            chunk_id = f"{user_storage_id}_chunk_{i}"
                            documents_to_store.append({
                                'id': chunk_id,
                                'user_storage_id': user_storage_id,
                                'content': chunk_text,
                                'page_range': str(i + 1),
                                'title': f"Chunk {i + 1}"
                            })

                        if documents_to_store:
                            stored_count = await pg_store.store_documents_batch(documents_to_store, model_type=model_type)
            else:
                # Non-PDF: Extract text and chunk
                logger.info(f"📝 Processing non-PDF file: {file_info.mimetype}")
                file_content = extract_text_from_file(temp_path, file_info.mimetype)

                if file_content.startswith("Error") or file_content.startswith("Unsupported"):
                    raise HTTPException(status_code=400, detail=file_content)

                # Split into chunks
                from langchain_text_splitters import RecursiveCharacterTextSplitter
                text_splitter = RecursiveCharacterTextSplitter(
                    chunk_size=2000,
                    chunk_overlap=200
                )
                text_chunks = text_splitter.split_text(file_content)

                # Prepare for batch storage
                documents_to_store = []
                for i, chunk_text in enumerate(text_chunks):
                    chunk_id = f"{user_storage_id}_chunk_{i}"
                    documents_to_store.append({
                        'id': chunk_id,
                        'user_storage_id': user_storage_id,
                        'content': chunk_text,
                        'page_range': str(i + 1),
                        'title': f"Chunk {i + 1}"
                    })

                if documents_to_store:
                    stored_count = await pg_store.store_documents_batch(documents_to_store, model_type=model_type)

            # Cleanup temp file
            if os.path.exists(temp_path):
                os.unlink(temp_path)

            if stored_count == 0:
                await ocr_service.update_processing_status(user_storage_id, "FAILED")
                raise HTTPException(status_code=400, detail="No content could be extracted from file")

            # Update status to COMPLETED
            await ocr_service.update_processing_status(user_storage_id, "COMPLETED", credit_charged=True)

            logger.info(f"✅ File processed successfully: {user_storage_id}, {stored_count} chunks")

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
        import traceback
        logger.error(f"Error processing file: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
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
