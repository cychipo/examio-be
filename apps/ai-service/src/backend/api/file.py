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
from typing import Dict, Any, List, Optional
from datetime import datetime

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field, ConfigDict

# Add the parent directory to sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from src.rag.retriever import extract_text_from_file, create_in_memory_retriever
from src.rag.simple_chat_agent import SimpleChatAgent
from src.rag.vector_store_pg import get_pg_vector_store
from src.backend.services.ocr_service import ocr_service
from src.llm.ollama_embeddings import get_embedding_text_limit

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter()

# Cache retrievers in memory for faster queries
_retriever_cache: Dict[str, Any] = {}

DEFAULT_OCR_TEXT_CHUNK_OVERLAP = 200


def _get_int_env(name: str, default: int, min_value: int = 1) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = int(raw)
        return max(min_value, value)
    except ValueError:
        logger.warning(f"Invalid {name}={raw!r}, using default={default}")
        return default


def _resolve_text_splitter_config() -> tuple[int, int, int]:
    embed_limit = get_embedding_text_limit()
    configured_chunk_size = _get_int_env("OCR_TEXT_CHUNK_SIZE", embed_limit)
    chunk_size = min(configured_chunk_size, embed_limit)

    default_overlap = min(DEFAULT_OCR_TEXT_CHUNK_OVERLAP, max(0, chunk_size - 1))
    configured_overlap = _get_int_env("OCR_TEXT_CHUNK_OVERLAP", default_overlap, min_value=0)
    chunk_overlap = min(configured_overlap, max(0, chunk_size - 1))

    if configured_chunk_size > chunk_size:
        logger.info(
            f"OCR_TEXT_CHUNK_SIZE={configured_chunk_size} exceeds OLLAMA_EMBED_MAX_LENGTH={embed_limit}; using chunk_size={chunk_size}"
        )
    if configured_overlap != chunk_overlap:
        logger.info(
            f"OCR_TEXT_CHUNK_OVERLAP={configured_overlap} exceeds allowed range for chunk_size={chunk_size}; using chunk_overlap={chunk_overlap}"
        )

    return chunk_size, chunk_overlap, embed_limit


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

            # --- LOCAL PROCESSING WITH TESSERACT FALLBACK ---
            from backend.services.pdf_ocr_service import pdf_ocr_service
            stored_count = 0
            pg_store = get_pg_vector_store()

            # Check file type
            is_pdf = file_info.mimetype == "application/pdf" or file_info.url.lower().endswith('.pdf')
            chunk_size, chunk_overlap, embed_limit = _resolve_text_splitter_config()
            logger.info(
                f"Text splitter config: chunk_size={chunk_size}, chunk_overlap={chunk_overlap}, embed_limit={embed_limit}"
            )

            if is_pdf:
                logger.info("📄 Processing PDF with local Tesseract/PyPDF...")
                try:
                    # Process PDF with chunks (split by pages + OCR each chunk)
                    chunk_results = pdf_ocr_service.process_pdf_with_chunks(file_bytes)

                    # PDF chunks are by pages (10 pages/chunk), need to split text further
                    from langchain_text_splitters import RecursiveCharacterTextSplitter
                    text_splitter = RecursiveCharacterTextSplitter(
                        chunk_size=chunk_size,
                        chunk_overlap=chunk_overlap,
                        separators=["\n\n", "\n", ". ", " ", ""]
                    )

                    # Prepare documents for batch storage
                    documents_to_store = []
                    chunk_idx = 0
                    
                    for page_chunk_index, page_chunk_text in chunk_results:
                        if not page_chunk_text or not page_chunk_text.strip():
                            continue

                        # Split large page chunks into smaller text chunks
                        text_chunks = text_splitter.split_text(page_chunk_text)
                        logger.info(f"📝 Page chunk {page_chunk_index}: {len(page_chunk_text)} chars → {len(text_chunks)} text chunks")
                        
                        for text_chunk in text_chunks:
                            if not text_chunk.strip():
                                continue
                            chunk_id = f"{user_storage_id}_chunk_{chunk_idx}"
                            documents_to_store.append({
                                'id': chunk_id,
                                'user_storage_id': user_storage_id,
                                'content': text_chunk.strip(),
                                'page_range': str(page_chunk_index),
                                'title': f"Chunk {chunk_idx + 1}"
                            })
                            chunk_idx += 1

                    if documents_to_store:
                        logger.info(f"📦 Storing {len(documents_to_store)} text chunks...")
                        stored_count = await pg_store.store_documents_batch(documents_to_store, model_type=model_type)
                except Exception as pdf_error:
                    logger.error(f"PDF processing failed: {pdf_error}")
                    raise pdf_error
            else:
                # Non-PDF: Extract text and chunk
                logger.info(f"📝 Processing non-PDF file: {file_info.mimetype}")
                from src.rag.retriever import extract_text_from_file
                file_content = extract_text_from_file(temp_path, file_info.mimetype)

                if file_content.startswith("Error") or file_content.startswith("Unsupported"):
                    raise HTTPException(status_code=400, detail=file_content)

                # Split into chunks
                from langchain_text_splitters import RecursiveCharacterTextSplitter
                text_splitter = RecursiveCharacterTextSplitter(chunk_size=chunk_size, chunk_overlap=chunk_overlap)
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
                "message": "OCR và lưu embeddings thành công (Tesseract Fallback)",
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

        # Determine model_type
        from src.llm.model_manager import model_manager, ModelType
        system_model_type = model_manager.get_model_type()
        requested_model = request.model_type
        
        # Consistent mapping: translate system ModelType to string id
        if not requested_model:
            requested_model = "fayedark" if system_model_type == ModelType.OLLAMA else "gemini"

        # Vector search
        pg_store = get_pg_vector_store()
        similar_docs = await pg_store.search_similar([user_storage_id], query, top_k=5, model_type=requested_model)

        if not similar_docs:
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

        # Determine model_type
        from src.llm.model_manager import model_manager, ModelType
        system_model_type = model_manager.get_model_type()
        requested_model = request.model_type
        
        if not requested_model:
            requested_model = "fayedark" if system_model_type == ModelType.OLLAMA else "gemini"

        retriever = await get_or_create_retriever(user_storage_id, model_type=requested_model)
        if not retriever:
            raise HTTPException(status_code=500, detail="Không thể tạo retriever")

        agent = SimpleChatAgent(custom_retriever=retriever, model_type=requested_model)
        pg_store = get_pg_vector_store()

        results = []
        for query in queries:
            answer = agent.chat(query)
            similar_docs = await pg_store.search_similar([user_storage_id], query, top_k=2, model_type=requested_model)

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
