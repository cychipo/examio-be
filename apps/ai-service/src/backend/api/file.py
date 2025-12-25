"""
API endpoints for file upload and queries with PostgreSQL storage

This module provides API endpoints for uploading files, querying files,
and getting information about uploaded files. Files are stored in PostgreSQL
with OCR caching to avoid re-processing.
"""
import logging
import os
import sys
import tempfile
import hashlib
import uuid
from typing import Dict, Any, List, Optional
from datetime import datetime

from fastapi import APIRouter, File, UploadFile, HTTPException, Body, Query, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

# Add the parent directory to sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from rag.retriever import extract_text_from_file, create_in_memory_retriever
from rag.simple_chat_agent import SimpleChatAgent
from rag.vector_store_pg import get_pg_vector_store
from backend.services.file_service import file_service, FileMetadata, DocumentChunk
from backend.auth.dependencies import require_auth

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create router
router = APIRouter()

# In-memory cache for retrievers (temporary, will be replaced with retriever from DB)
_retriever_cache: Dict[str, Any] = {}


class QueryRequest(BaseModel):
    """Request model for querying a file"""
    file_id: str = Field(..., description="ID of the uploaded file to query")
    query: str = Field(..., description="The query to run against the file")


class MultiQueryRequest(BaseModel):
    """Request model for querying a file with multiple questions"""
    file_id: str = Field(..., description="ID of the uploaded file to query")
    queries: List[str] = Field(..., description="List of queries to run against the file")


def compute_file_hash(content: bytes) -> str:
    """Compute SHA256 hash of file content"""
    return hashlib.sha256(content).hexdigest()


async def get_or_create_retriever(file_id: str, chunks: List[DocumentChunk]):
    """Get retriever from cache or create from DB chunks"""
    if file_id in _retriever_cache:
        return _retriever_cache[file_id]

    # Create retriever from document chunks
    if not chunks:
        return None

    combined_content = "\n\n".join([c.content for c in chunks])
    retriever, _ = create_in_memory_retriever(combined_content)
    _retriever_cache[file_id] = retriever
    return retriever


@router.post("/upload-file", response_model=Dict[str, Any])
async def upload_file(
    file: UploadFile = File(...),
    current_user = Depends(require_auth)
):
    """
    Upload a file with OCR caching - avoids re-processing same files

    Flow:
    1. Compute file hash
    2. Check if already processed in DB
    3. If yes → return existing data (skip OCR)
    4. If no → OCR, store embeddings, mark as COMPLETED
    """
    try:
        # Get user ID
        user_id = str(current_user.get("_id") or current_user.get("id"))
        if not user_id:
            raise HTTPException(status_code=401, detail="User ID not found")

        logger.info(f"Uploading file: {file.filename} for user: {user_id}")

        # Read file content
        content = await file.read()
        if len(content) == 0:
            raise HTTPException(status_code=400, detail="Empty file uploaded")

        # Compute hash for deduplication
        file_hash = compute_file_hash(content)

        # Check if file already processed
        existing_file = await file_service.check_file_exists(user_id, file_hash)

        if existing_file and existing_file.processing_status == "COMPLETED":
            # File already processed - return cached data
            logger.info(f"File already processed: {existing_file.id}, skipping OCR")

            # Get cached document chunks
            chunks = await file_service.get_file_documents(existing_file.id)

            return {
                "success": True,
                "cached": True,
                "message": "File đã được xử lý trước đó, bỏ qua OCR",
                "fileInfo": {
                    "id": existing_file.id,
                    "filename": existing_file.filename,
                    "size": existing_file.size,
                    "chunks": len(chunks),
                    "content_type": existing_file.mimetype,
                    "processing_status": existing_file.processing_status
                }
            }

        # New file - process it
        file_id = str(uuid.uuid4())

        # Create file record with PROCESSING status
        # Note: In production, file should be uploaded to R2 first
        file_url = f"local://{file_hash[:32]}/{file.filename}"

        await file_service.create_file_record(
            file_id=file_id,
            user_id=user_id,
            filename=file.filename,
            url=file_url,
            mimetype=file.content_type or "application/octet-stream",
            size=len(content),
            key_r2=file_hash,
            processing_status="PROCESSING"
        )

        # Extract text (OCR)
        suffix = os.path.splitext(file.filename)[1]
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_file.write(content)
            temp_path = temp_file.name

        try:
            file_content = extract_text_from_file(temp_path, file.content_type)
        finally:
            os.unlink(temp_path)

        if file_content.startswith("Error") or file_content.startswith("Unsupported"):
            await file_service.update_processing_status(file_id, "FAILED")
            raise HTTPException(status_code=400, detail=file_content)

        # Create chunks and store embeddings
        retriever, chunks = create_in_memory_retriever(file_content)

        # Store each chunk with embedding in PostgreSQL
        pg_store = get_pg_vector_store()
        stored_count = 0

        for i, chunk in enumerate(chunks):
            chunk_id = f"{file_id}_chunk_{i}"
            page_range = getattr(chunk, 'metadata', {}).get('page', str(i + 1))

            success = await pg_store.store_document(
                doc_id=chunk_id,
                user_storage_id=file_id,
                content=chunk.page_content,
                page_range=str(page_range),
                title=file.filename
            )
            if success:
                stored_count += 1

        # Mark as COMPLETED
        await file_service.update_processing_status(file_id, "COMPLETED", credit_charged=True)

        # Cache retriever
        _retriever_cache[file_id] = retriever

        logger.info(f"File processed: {file.filename}, ID: {file_id}, Chunks: {stored_count}")

        return {
            "success": True,
            "cached": False,
            "message": "File đã được OCR và lưu embeddings thành công",
            "fileInfo": {
                "id": file_id,
                "filename": file.filename,
                "size": len(content),
                "chunks": stored_count,
                "content_type": file.content_type,
                "processing_status": "COMPLETED"
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error processing file upload: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error processing file: {str(e)}")


@router.post("/query-file", response_model=Dict[str, Any])
async def query_file(
    request: QueryRequest,
    current_user = Depends(require_auth)
):
    """
    Query a file using vector similarity search from PostgreSQL
    """
    try:
        file_id = request.file_id
        query = request.query

        logger.info(f"Querying file ID: {file_id}, Query: {query}")

        # Get file from DB
        file_meta = await file_service.get_file_by_id(file_id)
        if not file_meta:
            raise HTTPException(status_code=404, detail="File not found")

        if file_meta.processing_status != "COMPLETED":
            raise HTTPException(status_code=400, detail=f"File is {file_meta.processing_status}")

        # Vector search using PgVectorStore
        pg_store = get_pg_vector_store()
        combined_content = await pg_store.search_and_combine(
            user_storage_ids=[file_id],
            query=query,
            top_k=5
        )

        if not combined_content:
            return {
                "success": True,
                "answer": "Không tìm thấy nội dung liên quan trong file.",
                "sources": [],
                "file": {"id": file_id, "filename": file_meta.filename}
            }

        # Get document chunks for retriever
        chunks = await file_service.get_file_documents(file_id)
        retriever = await get_or_create_retriever(file_id, chunks)

        if not retriever:
            raise HTTPException(status_code=500, detail="Could not create retriever")

        # Use agent to answer
        agent = SimpleChatAgent(custom_retriever=retriever)
        answer = agent.chat(query)

        # Get similar chunks as sources
        similar_docs = await pg_store.search_similar([file_id], query, top_k=3)
        sources = [doc.content[:500] for doc in similar_docs]

        return {
            "success": True,
            "answer": answer,
            "sources": sources,
            "file": {
                "id": file_id,
                "filename": file_meta.filename,
                "total_chunks": len(chunks)
            },
            "timestamp": str(datetime.now())
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error processing file query: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error processing query: {str(e)}")


@router.get("/file-info/{file_id}", response_model=Dict[str, Any])
async def get_file_info(
    file_id: str,
    current_user = Depends(require_auth)
):
    """Get information about an uploaded file from PostgreSQL"""
    file_meta = await file_service.get_file_by_id(file_id)

    if not file_meta:
        raise HTTPException(status_code=404, detail="File not found")

    chunks = await file_service.get_file_documents(file_id)

    # Preview from first chunks
    preview_text = ""
    for chunk in chunks[:3]:
        preview_text += chunk.content[:200] + "\n"
    preview_text = preview_text[:500] + "..." if len(preview_text) > 500 else preview_text

    return {
        "success": True,
        "fileInfo": {
            "id": file_id,
            "filename": file_meta.filename,
            "size": file_meta.size,
            "chunks": len(chunks),
            "content_type": file_meta.mimetype,
            "upload_time": file_meta.created_at.isoformat(),
            "processing_status": file_meta.processing_status,
            "preview": preview_text
        }
    }


@router.get("/list-files", response_model=Dict[str, Any])
async def list_files(
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user = Depends(require_auth)
):
    """List all uploaded files for current user from PostgreSQL"""
    user_id = str(current_user.get("_id") or current_user.get("id"))
    if not user_id:
        raise HTTPException(status_code=401, detail="User ID not found")

    files = await file_service.get_user_files(user_id, limit, offset)

    file_list = []
    for f in files:
        file_list.append({
            "id": f.id,
            "filename": f.filename,
            "size": f.size,
            "content_type": f.mimetype,
            "upload_time": f.created_at.isoformat(),
            "processing_status": f.processing_status
        })

    return {
        "success": True,
        "files": file_list,
        "count": len(file_list)
    }


@router.delete("/delete-file/{file_id}", response_model=Dict[str, Any])
async def delete_file(
    file_id: str,
    current_user = Depends(require_auth)
):
    """Delete a file and its documents from PostgreSQL"""
    file_meta = await file_service.get_file_by_id(file_id)

    if not file_meta:
        raise HTTPException(status_code=404, detail="File not found")

    # Delete documents first
    await file_service.delete_file_documents(file_id)

    # Remove from retriever cache
    if file_id in _retriever_cache:
        del _retriever_cache[file_id]

    logger.info(f"File deleted: {file_meta.filename}, ID: {file_id}")

    return {
        "success": True,
        "message": f"File '{file_meta.filename}' deleted successfully",
        "file_id": file_id
    }


@router.post("/multi-query-file", response_model=Dict[str, Any])
async def multi_query_file(
    request: MultiQueryRequest,
    current_user = Depends(require_auth)
):
    """Run multiple queries against a single file using PostgreSQL vector search"""
    try:
        file_id = request.file_id
        queries = request.queries

        if not queries:
            raise HTTPException(status_code=400, detail="No queries provided")

        # Get file
        file_meta = await file_service.get_file_by_id(file_id)
        if not file_meta:
            raise HTTPException(status_code=404, detail="File not found")

        if file_meta.processing_status != "COMPLETED":
            raise HTTPException(status_code=400, detail=f"File is {file_meta.processing_status}")

        # Get chunks and retriever
        chunks = await file_service.get_file_documents(file_id)
        retriever = await get_or_create_retriever(file_id, chunks)

        if not retriever:
            raise HTTPException(status_code=500, detail="Could not create retriever")

        agent = SimpleChatAgent(custom_retriever=retriever)
        pg_store = get_pg_vector_store()

        results = []
        for query in queries:
            answer = agent.chat(query)
            similar_docs = await pg_store.search_similar([file_id], query, top_k=2)
            sources = [doc.content[:300] for doc in similar_docs]

            results.append({
                "query": query,
                "answer": answer,
                "sources": sources
            })

        return {
            "success": True,
            "results": results,
            "file": {
                "id": file_id,
                "filename": file_meta.filename,
            },
            "timestamp": str(datetime.now())
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error processing multi-file query: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error processing queries: {str(e)}")
