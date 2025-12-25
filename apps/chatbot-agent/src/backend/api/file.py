"""
API endpoints for file upload and queries

This module provides API endpoints for uploading files, querying files,
and getting information about uploaded files. The uploaded files are stored
in memory temporarily and can be queried using a generated file_id.
"""
import logging
import os
import sys
import tempfile
from typing import Dict, Any, List, Optional
from datetime import datetime

from fastapi import APIRouter, File, UploadFile, HTTPException, Body, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

# Add the parent directory to sys.path to import our agent
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from rag.retriever import extract_text_from_file, create_in_memory_retriever
from rag.simple_chat_agent import SimpleChatAgent

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create router
router = APIRouter()

# Store uploaded files and their retrievers in memory temporarily
uploaded_files = {}

# Store folder structure
folder_structure = {
    "default": []  # Default folder to store files if no folder is specified
}

class QueryRequest(BaseModel):
    """Request model for querying a file"""
    file_id: str = Field(..., description="ID of the uploaded file to query")
    query: str = Field(..., description="The query to run against the file")

class MultiQueryRequest(BaseModel):
    """Request model for querying a file with multiple questions"""
    file_id: str = Field(..., description="ID of the uploaded file to query")
    queries: List[str] = Field(..., description="List of queries to run against the file")

class FolderRequest(BaseModel):
    """Request model for creating a folder"""
    folder_name: str = Field(..., description="Name of the folder to create")

class FolderRenameRequest(BaseModel):
    """Request model for renaming a folder"""
    old_name: str = Field(..., description="Current name of the folder")
    new_name: str = Field(..., description="New name for the folder")

@router.post("/upload-file", response_model=Dict[str, Any])
async def upload_file(
    file: UploadFile = File(...),
    folder: str = Query("default", description="Folder to store the file in")
):
    """
    Upload a file and create a retriever for it
    
    This endpoint allows uploading documents for question answering.
    Supported file types include PDF, DOCX, TXT, and more.
    
    Args:
        file: The file to upload
        folder: Folder name to store the file in (defaults to "default")
    
    Returns:
        A dictionary with file information including a unique file_id
        that can be used for querying the file later.
    """
    try:
        # Check if folder exists
        if folder not in folder_structure:
            logger.warning(f"Folder not found: {folder}, creating it")
            folder_structure[folder] = []
        
        # Log file upload attempt
        logger.info(f"Uploading file: {file.filename}, Content-Type: {file.content_type} to folder: {folder}")
        
        # Read file content
        content = await file.read()
        
        if len(content) == 0:
            raise HTTPException(status_code=400, detail="Empty file uploaded")
            
        # Create a temporary file
        suffix = os.path.splitext(file.filename)[1]
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_file.write(content)
            temp_path = temp_file.name
        
        # Extract text from file
        file_content = extract_text_from_file(temp_path, file.content_type)
        
        # Remove temporary file
        os.unlink(temp_path)
        
        if file_content.startswith("Error") or file_content.startswith("Unsupported"):
            logger.error(f"File processing error: {file_content}")
            raise HTTPException(status_code=400, detail=file_content)
        
        # Create retriever for file content
        retriever, chunks = create_in_memory_retriever(file_content)
        
        # Generate unique file ID
        file_id = f"file_{hash(file.filename)}_{hash(file_content[:100])}"
        
        # Store retriever in memory
        uploaded_files[file_id] = {
            "filename": file.filename,
            "retriever": retriever,
            "content": file_content,
            "chunks": chunks,
            "upload_time": str(datetime.now()),
            "content_type": file.content_type,
            "folder": folder
        }
        
        # Add file reference to folder structure
        folder_structure[folder].append(file_id)
        
        logger.info(f"File uploaded successfully: {file.filename}, ID: {file_id}, Chunks: {len(chunks)}, Folder: {folder}")
        
        return {
            "success": True,
            "fileInfo": {
                "id": file_id,
                "filename": file.filename,
                "size": len(file_content),
                "chunks": len(chunks),
                "content_type": file.content_type,
                "folder": folder
            }
        }
    
    except Exception as e:
        logger.error(f"Error processing file upload: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error processing file: {str(e)}")

@router.post("/query-file", response_model=Dict[str, Any])
async def query_file(request: QueryRequest):
    """
    Query a specific uploaded file
    
    This endpoint allows you to ask questions about a previously uploaded file.
    
    Args:
        request: QueryRequest object containing file_id and query
        
    Returns:
        A response containing the answer to the query and relevant source context
    """
    try:
        file_id = request.file_id
        query = request.query
        
        logger.info(f"Querying file ID: {file_id}, Query: {query}")
        
        # Check if file exists
        if file_id not in uploaded_files:
            logger.warning(f"File not found: {file_id}")
            raise HTTPException(status_code=404, detail="File not found. It may have expired.")
        
        # Get retriever for file
        file_data = uploaded_files[file_id]
        retriever = file_data["retriever"]
        
        # Create agent with file retriever
        agent = SimpleChatAgent(custom_retriever=retriever)
        
        # Process query
        answer = agent.chat(query)
        
        # Get sources for context
        docs = retriever.get_relevant_documents(query)
        sources = [doc.page_content for doc in docs[:3]]
        
        logger.info(f"Query processed successfully for file: {file_data['filename']}")
        
        return {
            "success": True,
            "answer": answer,
            "sources": sources,
            "file": {
                "id": file_id,
                "filename": file_data["filename"],
                "total_chunks": len(file_data["chunks"])
            },
            "timestamp": str(datetime.now())
        }
    
    except Exception as e:
        logger.error(f"Error processing file query: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error processing query: {str(e)}")

@router.post("/multi-query-file", response_model=Dict[str, Any])
async def multi_query_file(request: MultiQueryRequest):
    """
    Run multiple queries against a single file
    
    This endpoint allows you to ask multiple questions about a previously uploaded file
    in a single request.
    
    Args:
        request: MultiQueryRequest object containing file_id and a list of queries
        
    Returns:
        A response containing answers to all queries with their relevant source contexts
    """
    try:
        file_id = request.file_id
        queries = request.queries
        
        if not queries:
            raise HTTPException(status_code=400, detail="No queries provided")
            
        logger.info(f"Multi-querying file ID: {file_id}, Queries: {len(queries)}")
        
        # Check if file exists
        if file_id not in uploaded_files:
            logger.warning(f"File not found: {file_id}")
            raise HTTPException(status_code=404, detail="File not found. It may have expired.")
        
        # Get retriever for file
        file_data = uploaded_files[file_id]
        retriever = file_data["retriever"]
        
        # Create agent with file retriever
        agent = SimpleChatAgent(custom_retriever=retriever)
        
        # Process all queries
        results = []
        for query in queries:
            # Process query
            answer = agent.chat(query)
            
            # Get sources for context
            docs = retriever.get_relevant_documents(query)
            sources = [doc.page_content for doc in docs[:2]]  # Limit to 2 sources per query
            
            results.append({
                "query": query,
                "answer": answer,
                "sources": sources
            })
        
        logger.info(f"Multi-query processed successfully for file: {file_data['filename']}")
        
        return {
            "success": True,
            "results": results,
            "file": {
                "id": file_id,
                "filename": file_data["filename"],
            },
            "timestamp": str(datetime.now())
        }
    
    except Exception as e:
        logger.error(f"Error processing multi-file query: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error processing queries: {str(e)}")

@router.get("/file-info/{file_id}", response_model=Dict[str, Any])
async def get_file_info(file_id: str):
    """
    Get information about an uploaded file
    
    This endpoint returns details about a previously uploaded file.
    
    Args:
        file_id: The ID of the file to get information about
        
    Returns:
        A response containing information about the file
    """
    if file_id not in uploaded_files:
        logger.warning(f"File info requested for non-existent file: {file_id}")
        raise HTTPException(status_code=404, detail="File not found. It may have expired.")
    
    file_data = uploaded_files[file_id]
    
    # Get the first few chunks as preview
    preview_chunks = file_data["chunks"][:3]
    preview_text = "\n".join([chunk.page_content for chunk in preview_chunks]) if preview_chunks else ""
    # Limit preview text to 500 characters
    preview_text = preview_text[:500] + "..." if len(preview_text) > 500 else preview_text
    
    return {
        "success": True,
        "fileInfo": {
            "id": file_id,
            "filename": file_data["filename"],
            "size": len(file_data["content"]),
            "chunks": len(file_data["chunks"]),
            "content_type": file_data.get("content_type", "unknown"),
            "upload_time": file_data.get("upload_time", "unknown"),
            "preview": preview_text
        }
    }

@router.get("/list-files", response_model=Dict[str, Any])
async def list_files(folder: Optional[str] = Query(None, description="Folder to list files from")):
    """
    List all uploaded files
    
    This endpoint returns a list of all files that have been uploaded
    and are still available for querying.
    
    Args:
        folder: Optional folder name to filter files by
        
    Returns:
        A response containing a list of file information
    """
    file_list = []
    
    if folder:
        # List files from a specific folder
        if folder not in folder_structure:
            return {
                "success": True,
                "files": [],
                "count": 0
            }
        
        file_ids = folder_structure[folder]
        for file_id in file_ids:
            if file_id in uploaded_files:
                file_data = uploaded_files[file_id]
                file_list.append({
                    "id": file_id,
                    "filename": file_data["filename"],
                    "size": len(file_data["content"]),
                    "chunks": len(file_data["chunks"]),
                    "content_type": file_data.get("content_type", "unknown"),
                    "upload_time": file_data.get("upload_time", "unknown"),
                    "folder": file_data.get("folder", "default")
                })
    else:
        # List all files
        for file_id, file_data in uploaded_files.items():
            file_list.append({
                "id": file_id,
                "filename": file_data["filename"],
                "size": len(file_data["content"]),
                "chunks": len(file_data["chunks"]),
                "content_type": file_data.get("content_type", "unknown"),
                "upload_time": file_data.get("upload_time", "unknown"),
                "folder": file_data.get("folder", "default")
            })
    
    return {
        "success": True,
        "files": file_list,
        "count": len(file_list)
    }

@router.delete("/delete-file/{file_id}", response_model=Dict[str, Any])
async def delete_file(file_id: str):
    """
    Delete an uploaded file
    
    This endpoint removes a file from memory, freeing up resources.
    
    Args:
        file_id: The ID of the file to delete
        
    Returns:
        A response indicating success or failure
    """
    if file_id not in uploaded_files:
        logger.warning(f"Delete requested for non-existent file: {file_id}")
        raise HTTPException(status_code=404, detail="File not found. It may have expired.")
    
    file_data = uploaded_files[file_id]
    filename = file_data["filename"]
    folder = file_data.get("folder", "default")
    
    # Remove file reference from folder structure
    if folder in folder_structure and file_id in folder_structure[folder]:
        folder_structure[folder].remove(file_id)
    
    # Remove the file from memory
    del uploaded_files[file_id]
    
    logger.info(f"File deleted: {filename}, ID: {file_id}, from folder: {folder}")
    
    return {
        "success": True,
        "message": f"File '{filename}' deleted successfully",
        "file_id": file_id
    }

@router.get("/list-folders", response_model=Dict[str, Any])
async def list_folders():
    """
    List all available folders
    
    This endpoint returns a list of all folders and the number of files in each.
    
    Returns:
        A response containing a list of folders with file counts
    """
    folder_list = []
    
    for folder_name, file_ids in folder_structure.items():
        # Count only valid file IDs
        valid_files = [file_id for file_id in file_ids if file_id in uploaded_files]
        
        folder_list.append({
            "name": folder_name,
            "files_count": len(valid_files),
            "is_default": folder_name == "default"
        })
    
    return {
        "success": True,
        "folders": folder_list,
        "count": len(folder_list)
    }

@router.post("/create-folder", response_model=Dict[str, Any])
async def create_folder(request: FolderRequest):
    """
    Create a new folder
    
    This endpoint creates a new folder to organize files.
    
    Args:
        request: FolderRequest object containing folder_name
        
    Returns:
        A response indicating success or failure
    """
    folder_name = request.folder_name.strip()
    
    if not folder_name:
        raise HTTPException(status_code=400, detail="Folder name cannot be empty")
    
    if folder_name in folder_structure:
        raise HTTPException(status_code=400, detail=f"Folder '{folder_name}' already exists")
    
    folder_structure[folder_name] = []
    
    logger.info(f"Folder created: {folder_name}")
    
    return {
        "success": True,
        "message": f"Folder '{folder_name}' created successfully",
        "folder_name": folder_name
    }

@router.delete("/delete-folder/{folder_name}", response_model=Dict[str, Any])
async def delete_folder(folder_name: str, delete_files: bool = Query(True, description="Whether to delete files in the folder")):
    """
    Delete a folder
    
    This endpoint removes a folder and optionally its files.
    
    Args:
        folder_name: The name of the folder to delete
        delete_files: Whether to delete files in the folder or move them to default
        
    Returns:
        A response indicating success or failure
    """
    if folder_name not in folder_structure:
        raise HTTPException(status_code=404, detail=f"Folder '{folder_name}' not found")
    
    if folder_name == "default":
        raise HTTPException(status_code=400, detail="Cannot delete the default folder")
    
    file_ids = folder_structure[folder_name]
    deleted_files = 0
    moved_files = 0
    
    # Handle files in the folder
    for file_id in list(file_ids):  # Create a copy of the list for iteration
        if file_id in uploaded_files:
            if delete_files:
                # Delete the file
                del uploaded_files[file_id]
                deleted_files += 1
            else:
                # Move to default folder
                file_data = uploaded_files[file_id]
                file_data["folder"] = "default"
                folder_structure["default"].append(file_id)
                moved_files += 1
    
    # Delete the folder
    del folder_structure[folder_name]
    
    logger.info(f"Folder deleted: {folder_name}, files deleted: {deleted_files}, files moved: {moved_files}")
    
    return {
        "success": True,
        "message": f"Folder '{folder_name}' deleted successfully",
        "deleted_files": deleted_files,
        "moved_files": moved_files
    }

@router.put("/rename-folder", response_model=Dict[str, Any])
async def rename_folder(request: FolderRenameRequest):
    """
    Rename a folder
    
    This endpoint renames an existing folder.
    
    Args:
        request: FolderRenameRequest object containing old_name and new_name
        
    Returns:
        A response indicating success or failure
    """
    old_name = request.old_name.strip()
    new_name = request.new_name.strip()
    
    if not new_name:
        raise HTTPException(status_code=400, detail="New folder name cannot be empty")
    
    if old_name not in folder_structure:
        raise HTTPException(status_code=404, detail=f"Folder '{old_name}' not found")
    
    if old_name == "default":
        raise HTTPException(status_code=400, detail="Cannot rename the default folder")
    
    if new_name in folder_structure:
        raise HTTPException(status_code=400, detail=f"Folder '{new_name}' already exists")
    
    # Get files from old folder
    file_ids = folder_structure[old_name]
    
    # Create new folder with same files
    folder_structure[new_name] = file_ids
    
    # Update folder name in file metadata
    for file_id in file_ids:
        if file_id in uploaded_files:
            uploaded_files[file_id]["folder"] = new_name
    
    # Delete old folder
    del folder_structure[old_name]
    
    logger.info(f"Folder renamed: {old_name} -> {new_name}")
    
    return {
        "success": True,
        "message": f"Folder renamed from '{old_name}' to '{new_name}' successfully",
        "files_updated": len(file_ids)
    }
