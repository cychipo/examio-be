"""
API endpoints for managing RAG training data

This module provides API endpoints for uploading files to the data directory
for RAG training, listing available training files, and deleting training files.
"""
import logging
import os
import sys
import shutil
from typing import Dict, Any, List, Optional
from datetime import datetime
import uuid

from fastapi import APIRouter, File, UploadFile, HTTPException, Body, Query, Depends, Path
from fastapi.responses import JSONResponse, FileResponse
from pydantic import BaseModel, Field

# Add the parent directory to sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from backend.auth.jwt import get_current_user
from backend.models.user import UserResponse
from rag.retriever import extract_text_from_file
from rag.docling_extractor import extract_text_with_docling, is_docling_available

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create router
router = APIRouter()

# Define the data directory path
DATA_DIR = os.path.abspath(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))), "data"))

# Ensure directories exist
if not os.path.exists(DATA_DIR):
    os.makedirs(DATA_DIR)
    logger.info(f"Created data directory at {DATA_DIR}")

class FileInfo(BaseModel):
    """Model for file information"""
    filename: str
    size: int
    last_modified: str
    path: str

class FolderRequest(BaseModel):
    """Request model for creating a folder"""
    folder_name: str = Field(..., description="Name of the folder to create")

class SubfolderRequest(BaseModel):
    """Request model for creating a subfolder"""
    parent_folder: str = Field(..., description="Name of the parent folder")
    subfolder_name: str = Field(..., description="Name of the subfolder to create")

class FolderRenameRequest(BaseModel):
    """Request model for renaming a folder"""
    old_name: str = Field(..., description="Current name of the folder")
    new_name: str = Field(..., description="New name for the folder")

@router.post("/upload-training-file", response_model=Dict[str, Any])
async def upload_training_file(
    file: UploadFile = File(...),
    folder: str = Query(..., description="Folder to store the file in (department folder required)"),
    current_user: dict = Depends(get_current_user)
):
    """
    Upload a file to the data directory for RAG training
    
    This endpoint allows administrators to upload documents for RAG training.
    Supported file types include PDF, DOCX, TXT.
    A valid department folder is required.
    
    Args:
        file: The file to upload
        folder: The department folder to store the file in (required)
        
    Returns:
        A dictionary with file information
    """
    # Check if user is admin
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only administrators can upload training files")
    
    try:
        # Log file upload attempt
        logger.info(f"Uploading training file: {file.filename}, Content-Type: {file.content_type}, to folder: {folder}")
        
        # Read file content
        content = await file.read()
        
        if len(content) == 0:
            raise HTTPException(status_code=400, detail="Empty file uploaded")
        
        # Ensure only allowed file types
        allowed_extensions = ['.txt', '.pdf', '.docx']
        file_ext = os.path.splitext(file.filename)[1].lower()
        
        if file_ext not in allowed_extensions:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file type. Please upload files with these extensions: {', '.join(allowed_extensions)}"
            )
        
        # Determine folder path - always use subfolders, no more root DATA_DIR storage
        if "/" in folder:
            # Đây là subfolder, cần xử lý đường dẫn đặc biệt
            folder_parts = folder.split("/")
            # Bắt đầu từ DATA_DIR và xây dựng đường dẫn dựa trên các phần của folder
            current_path = DATA_DIR
            for part in folder_parts:
                current_path = os.path.join(current_path, part)
            folder_path = current_path
        else:
            # Tất cả folders đều là subfolders của DATA_DIR, kể cả "default"
            folder_path = os.path.join(DATA_DIR, folder)
        
        # Create folder if it doesn't exist
        if not os.path.exists(folder_path):
            os.makedirs(folder_path)
            logger.info(f"Created folder: {folder_path}")
        
        # Use original filename for simplicity in this version
        safe_filename = file.filename
        file_path = os.path.join(folder_path, safe_filename)
        
        # Log the file path
        logger.info(f"Saving file to: {file_path}")
        
        # Save the file to the data directory
        with open(file_path, "wb") as f:
            f.write(content)
        
        # Extract text using Docling for all file types
        if is_docling_available():
            logger.info(f"Extracting text using Docling for {safe_filename}")
            extracted_text = extract_text_with_docling(file_path)
            
            if extracted_text:
                # Save extracted text as .md file
                md_file_path = os.path.splitext(file_path)[0] + ".md"
                with open(md_file_path, "w", encoding="utf-8") as md_file:
                    md_file.write(extracted_text)
                logger.info(f"Saved extracted markdown to {md_file_path}")
            else:
                logger.warning(f"Failed to extract text from {safe_filename} using Docling")
        else:
            logger.warning("Docling not available, skipping text extraction")
        
        # Skip legacy text extraction
        # For non-text files, also create a text version for easy viewing/processing
        if False and file_ext != '.txt':
            try:
                logger.info(f"Extracting text from {file.filename} with content type {file.content_type}")
                text_content = extract_text_from_file(file_path, file.content_type)
                
                if text_content.startswith("Error") or text_content.startswith("Unsupported"):
                    logger.warning(f"Problem extracting text: {text_content}")
                else:
                    text_file_path = os.path.splitext(file_path)[0] + ".txt"
                    with open(text_file_path, "w", encoding="utf-8") as f:
                        f.write(text_content)
                    logger.info(f"Extracted text saved to {text_file_path}")
            except Exception as e:
                logger.warning(f"Could not extract text from {file.filename}: {str(e)}")
        
        file_size = os.path.getsize(file_path)
        
        logger.info(f"Training file uploaded successfully: {safe_filename}, Size: {file_size} bytes")
        
        return {
            "success": True,
            "fileInfo": {
                "filename": safe_filename,
                "originalName": file.filename,
                "size": file_size,
                "uploadedBy": current_user["username"],
                "uploadTime": str(datetime.now())
            },
            "message": "File uploaded successfully. Please click 'Rebuild RAG Index' to update the system."
        }
    
    except Exception as e:
        logger.error(f"Error processing training file upload: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error processing file: {str(e)}")

@router.get("/list-training-files", response_model=Dict[str, Any])
async def list_training_files(current_user: dict = Depends(get_current_user)):
    """
    List all files in the data directory for RAG training
    
    This endpoint allows administrators to view all available training files.
    
    Returns:
        A response containing a list of file information
    """
    # Check if user is admin
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only administrators can view training files")
    
    try:
        file_list = []
        
        # Ensure data directory exists
        if not os.path.exists(DATA_DIR):
            os.makedirs(DATA_DIR)
            logger.info(f"Created data directory at {DATA_DIR}")
            return {
                "success": True,
                "files": [],
                "count": 0,
                "message": "Data directory was empty and has been created"
            }
        
        # Function to get files from a folder
        def get_files_from_folder(folder_path, folder_name="default"):
            folder_files = []
            if os.path.exists(folder_path) and os.path.isdir(folder_path):
                for filename in os.listdir(folder_path):
                    file_path = os.path.join(folder_path, filename)
                    if os.path.isfile(file_path):
                        # Skip .gitkeep and other hidden files
                        if filename.startswith('.'):
                            continue
                            
                        file_stat = os.stat(file_path)
                        folder_files.append({
                            "filename": filename,
                            "folder": folder_name,
                            "size": file_stat.st_size,
                            "last_modified": str(datetime.fromtimestamp(file_stat.st_mtime)),
                            "path": file_path
                        })
                    # Đệ quy xuống các subfolder
                    elif os.path.isdir(file_path) and filename != "__pycache__":
                        subfolder_name = f"{folder_name}/{filename}" if folder_name != "default" else filename
                        folder_files.extend(get_files_from_folder(file_path, subfolder_name))
            return folder_files
        
        # Get files from default folder (DATA_DIR)
        file_list.extend(get_files_from_folder(DATA_DIR))
        
        # Chúng ta không cần đoạn mã dưới đây vì hàm get_files_from_folder đã được cập nhật
        # để duyệt qua tất cả các subfolder một cách đệ quy
        # for item in os.listdir(DATA_DIR):
        #     item_path = os.path.join(DATA_DIR, item)
        #     if os.path.isdir(item_path) and item != "__pycache__":
        #         file_list.extend(get_files_from_folder(item_path, item))
        
        logger.info(f"Found {len(file_list)} files in the data directory")
        
        return {
            "success": True,
            "files": file_list,
            "count": len(file_list)
        }
    
    except Exception as e:
        logger.error(f"Error listing training files: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error listing files: {str(e)}")

@router.delete("/delete-training-file/{filename}", response_model=Dict[str, Any])
async def delete_training_file(
    filename: str,
    folder: str = Query(..., description="Folder containing the file"),
    current_user: dict = Depends(get_current_user)
):
    """
    Delete a file from the data directory
    
    This endpoint allows administrators to delete training files.
    
    Args:
        filename: The name of the file to delete
        folder: The folder containing the file (required)
        
    Returns:
        A response indicating success or failure
    """
    # Check if user is admin
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only administrators can delete training files")
    
    try:
        # Determine folder path - always use subfolders, no more root DATA_DIR storage
        if "/" in folder:
            # Đây là subfolder, cần xử lý đường dẫn đặc biệt
            folder_parts = folder.split("/")
            # Bắt đầu từ DATA_DIR và xây dựng đường dẫn dựa trên các phần của folder
            current_path = DATA_DIR
            for part in folder_parts:
                current_path = os.path.join(current_path, part)
            folder_path = current_path
        else:
            # Tất cả folders đều là subfolders của DATA_DIR, kể cả "default"
            folder_path = os.path.join(DATA_DIR, folder)
            
        file_path = os.path.join(folder_path, filename)
        
        # Check if file exists
        if not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail=f"File {filename} not found in folder {folder}")
        
        # Delete the file
        os.remove(file_path)
        
        # Also delete the markdown version if it exists
        md_file_path = os.path.splitext(file_path)[0] + ".md"
        if os.path.exists(md_file_path):
            os.remove(md_file_path)
            logger.info(f"Deleted markdown version: {md_file_path}")
        
        logger.info(f"Training file deleted: {filename}")
        
        return {
            "success": True,
            "message": f"File '{filename}' deleted successfully. Please click 'Rebuild RAG Index' to update the system.",
            "filename": filename
        }
    
    except Exception as e:
        logger.error(f"Error deleting training file: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error deleting file: {str(e)}")

@router.post("/rebuild-rag-index", response_model=Dict[str, Any])
async def rebuild_rag_index(current_user: dict = Depends(get_current_user)):
    """
    Rebuild the document graph and reload the RAG agent
    
    This endpoint triggers a rebuild of the document graph from data files
    and reloads the RAG agent to use the updated graph.
    
    Returns:
        A response indicating success or failure
    """
    # Check if user is admin
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only administrators can rebuild the graph")
    
    try:
        logger.info(f"Starting graph rebuild from data directory: {DATA_DIR}")
        
        # Import required modules
        from rag.table_aware_chunking import load_documents_from_folder
        from graph_rag.graph_builder import DocumentGraph
        import time
        
        # Get project root and output folder
        project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
        output_folder = os.path.join(project_root, "document_graph")
        os.makedirs(output_folder, exist_ok=True)
        
        # Step 1: Load documents with table-aware chunking
        logger.info("Loading documents with table-aware chunking...")
        start_time = time.time()
        documents = load_documents_from_folder(
            data_folder=DATA_DIR,
            chunk_size=800,
            chunk_overlap=200
        )
        load_time = time.time() - start_time
        logger.info(f"Loaded {len(documents)} document chunks in {load_time:.2f}s")
        
        # Count special chunks
        table_chunks = sum(1 for doc in documents if doc.metadata.get('contains_table', False))
        logger.info(f"Table chunks: {table_chunks}, Regular chunks: {len(documents) - table_chunks}")
        
        # Step 2: Build document graph
        logger.info("Building document graph...")
        start_time = time.time()
        graph_builder = DocumentGraph(
            semantic_threshold=0.7,
            max_semantic_edges_per_node=5
        )
        graph = graph_builder.build_graph(documents)
        graph_build_time = time.time() - start_time
        
        logger.info(f"Graph built in {graph_build_time:.2f}s")
        logger.info(f"Nodes: {graph.number_of_nodes()}, Edges: {graph.number_of_edges()}")
        
        # Step 3: Save graph
        graph_path = os.path.join(output_folder, "graph.pkl")
        graph_builder.save_graph(graph_path)
        logger.info(f"Graph saved to: {graph_path}")
        
        # Step 3.5: Clear GraphRAG cache to force reload of new graph
        logger.info("Clearing GraphRAG cache...")
        try:
            from rag.rag_graph import clear_retriever_cache
            clear_retriever_cache()
            logger.info("✅ GraphRAG cache cleared successfully")
        except Exception as cache_error:
            logger.warning(f"⚠️  Could not clear cache: {cache_error}")
        
        # Step 4: Reload ReActGraph agent
        logger.info("Reloading ReActGraph agent...")
        from backend.api.chat import agent
        from agent.supervisor_agent import ReActGraph
        
        # Reinitialize agent with new graph
        new_agent = ReActGraph()
        new_agent.create_graph()
        
        # Reassign global agent variable in chat module
        import backend.api.chat
        backend.api.chat.agent = new_agent
        
        logger.info("ReActGraph agent reloaded successfully")
        
        total_time = load_time + graph_build_time
        
        return {
            "success": True,
            "message": f"Document graph rebuilt successfully with {len(documents)} chunks, {graph.number_of_nodes()} nodes, {graph.number_of_edges()} edges",
            "details": {
                "total_chunks": len(documents),
                "table_chunks": table_chunks,
                "regular_chunks": len(documents) - table_chunks,
                "graph_nodes": graph.number_of_nodes(),
                "graph_edges": graph.number_of_edges(),
                "build_time_seconds": round(total_time, 2)
            }
        }
    
    except Exception as e:
        logger.error(f"Error rebuilding graph: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Error rebuilding common graph: {str(e)}")

@router.post("/rebuild-department-rag-index", response_model=Dict[str, Any])
async def rebuild_department_rag_index(
    department: str = Body(..., description="Department name to rebuild"),
    current_user: dict = Depends(get_current_user)
):
    """
    Rebuild the RAG index for a specific department only
    
    This endpoint triggers a rebuild of the graph for a specific department
    from its data files and reloads the RAG agent.
    
    Args:
        department: Name of the department to rebuild (e.g., 'phongdaotao', 'phongkhaothi')
        
    Returns:
        A response indicating success or failure
    """
    # Check if user is admin
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only administrators can rebuild the graph")
    
    try:
        logger.info(f"Starting department-specific graph rebuild: {department}")
        
        # Import required modules
        from rag.table_aware_chunking import load_documents_from_folder
        from graph_rag.department_graph_manager import DepartmentGraphManager
        import time
        
        # Get project root and output folder
        project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
        output_folder = os.path.join(project_root, "department_graphs")
        
        # Get available departments dynamically - scan for actual department folders including 'default'
        available_departments = []
        
        # Scan for department folders in DATA_DIR
        if os.path.exists(DATA_DIR):
            for item in os.listdir(DATA_DIR):
                item_path = os.path.join(DATA_DIR, item)
                if os.path.isdir(item_path) and not item.startswith('.') and item != '__pycache__':
                    available_departments.append(item)
        
        logger.info(f"Available departments: {available_departments}")
        
        # Validate department - allow any folder including 'default'
        if department not in available_departments and department != 'default':
            # If department not in available list, but we allow creating new departments
            logger.info(f"Department {department} not found in available departments, but allowing anyway")
        
        # Step 1: Load documents for specific department
        logger.info(f"Loading documents for department: {department}...")
        start_time = time.time()
        
        # Load from specific department folder
        dept_data_folder = os.path.join(DATA_DIR, department)
        logger.info(f"Department data folder: {dept_data_folder}")
        logger.info(f"Folder exists: {os.path.exists(dept_data_folder)}")
        
        if not os.path.exists(dept_data_folder):
            # If folder doesn't exist, create it or return error
            logger.warning(f"Department folder not found: {dept_data_folder}")
            return {
                "success": True,
                "message": f"Department folder '{department}' not found. Nothing to rebuild.",
                "details": {
                    "department": department,
                    "total_chunks": 0,
                    "build_time_seconds": 0
                }
            }
        
        # List files in the department folder for debugging
        files_in_folder = []
        try:
            for item in os.listdir(dept_data_folder):
                item_path = os.path.join(dept_data_folder, item)
                if os.path.isfile(item_path):
                    file_size = os.path.getsize(item_path)
                    files_in_folder.append(f"{item} ({file_size} bytes)")
            logger.info(f"Files found in {department} folder: {files_in_folder}")
        except Exception as e:
            logger.error(f"Error listing files in {dept_data_folder}: {e}")
        
        # Try to load documents with more detailed logging
        logger.info(f"Attempting to load documents from: {dept_data_folder}")
        try:
            documents = load_documents_from_folder(
                data_folder=dept_data_folder,
                chunk_size=800,
                chunk_overlap=200
            )
            logger.info(f"Successfully loaded {len(documents)} documents")
            if len(documents) > 0:
                logger.info(f"First document metadata: {documents[0].metadata}")
                logger.info(f"First document content preview: {documents[0].page_content[:200]}...")
        except Exception as e:
            logger.error(f"Error in load_documents_from_folder: {e}")
            import traceback
            logger.error(traceback.format_exc())
            # Return with specific error
            return {
                "success": False,
                "message": f"Error loading documents from department {department}: {str(e)}",
                "details": {
                    "department": department,
                    "total_chunks": 0,
                    "build_time_seconds": 0,
                    "error": str(e)
                }
            }
        
        logger.info(f"Documents loaded by load_documents_from_folder: {len(documents)}")
        
        # For department rebuild, we want all documents from that specific folder
        dept_documents = documents  # Use all documents from the department folder
        
        load_time = time.time() - start_time
        logger.info(f"Loaded {len(dept_documents)} documents for {department} in {load_time:.2f}s")
        
        if len(dept_documents) == 0:
            return {
                "success": True,
                "message": f"No documents found for department {department}. Nothing to rebuild.",
                "details": {
                    "department": department,
                    "total_chunks": 0,
                    "build_time_seconds": 0
                }
            }
        
        # Step 2: Build graph for specific department
        logger.info(f"Đang xây dựng chỉ mục cho phòng ban: {department}...")
        start_time = time.time()
        
        dept_manager = DepartmentGraphManager(output_folder)
        
        # Create department documents dictionary for build function
        dept_docs_dict = {department: dept_documents}
        # Pass empty list as first param and override dict as second param
        department_stats = dept_manager.build_department_graphs([], dept_documents_override=dept_docs_dict)
        
        graph_build_time = time.time() - start_time
        
        nodes_count = department_stats.get(department, 0)
        logger.info(f"Graph for {department} built in {graph_build_time:.2f}s")
        logger.info(f"Nodes: {nodes_count}")
        
        # Step 3: Clear GraphRAG cache to force reload
        logger.info("Clearing GraphRAG cache...")
        try:
            from rag.rag_graph import clear_retriever_cache
            clear_retriever_cache()
            logger.info("✅ GraphRAG cache cleared successfully")
        except Exception as cache_error:
            logger.warning(f"⚠️  Could not clear cache: {cache_error}")
        
        # Step 4: Reload ReActGraph agent
        logger.info("Reloading ReActGraph agent...")
        from backend.api.chat import agent
        from agent.supervisor_agent import ReActGraph
        
        # Reinitialize agent with updated department graphs
        new_agent = ReActGraph()
        new_agent.create_graph()
        
        # Reassign global agent variable in chat module
        import backend.api.chat
        backend.api.chat.agent = new_agent
        
        logger.info("ReActGraph agent reloaded successfully")
        
        total_time = load_time + graph_build_time
        
        return {
            "success": True,
            "message": f"Chỉ mục cho phòng ban '{department}' được xây dựng lại thành công với {len(dept_documents)} đoạn và {nodes_count} nút",
            "details": {
                "department": department,
                "total_chunks": len(dept_documents),
                "graph_nodes": nodes_count,
                "build_time_seconds": round(total_time, 2)
            }
        }
    
    except Exception as e:
        logger.error(f"Error rebuilding graph for department {department}: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Lỗi khi xây dựng lại chỉ mục cho phòng ban {department}: {str(e)}")

@router.get("/list-departments", response_model=Dict[str, Any])
async def list_departments(current_user: dict = Depends(get_current_user)):
    """
    List available departments for RAG index rebuilding
    
    Returns:
        A response containing a list of available departments
    """
    # Check if user is admin
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only administrators can view departments")
    
    try:
        departments = []
        
        # Scan for department folders dynamically - no default folder
        if os.path.exists(DATA_DIR):
            for item in os.listdir(DATA_DIR):
                item_path = os.path.join(DATA_DIR, item)
                if os.path.isdir(item_path) and not item.startswith('.') and item != '__pycache__':
                    # Check if folder has any files
                    has_data = False
                    try:
                        files_in_dept = [f for f in os.listdir(item_path) if os.path.isfile(os.path.join(item_path, f)) and not f.startswith('.')]
                        has_data = len(files_in_dept) > 0
                    except:
                        has_data = False
                    
                    # Create display names (with fallback for unknown departments)
                    display_names = {
                        'default': 'Thư mục mặc định',
                        'phongdaotao': 'Phòng Đào Tạo',
                        'phongkhaothi': 'Phòng Khảo Thí',
                        'viennghiencuuvahoptacphattrien': 'Viện Nghiên Cứu và Hợp Tác Phát Triển'
                    }
                    
                    departments.append({
                        "name": item,
                        "display_name": display_names.get(item, item.title()),
                        "description": f"Dữ liệu của {display_names.get(item, item.title())}",
                        "has_data": has_data
                    })
        
        return {
            "success": True,
            "departments": departments,
            "count": len(departments)
        }
    
    except Exception as e:
        logger.error(f"Error listing departments: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error listing departments: {str(e)}")

# Folder Management Endpoints

@router.post("/create-folder", response_model=Dict[str, Any])
async def create_folder(request: FolderRequest, current_user: dict = Depends(get_current_user)):
    """
    Create a new folder in the data directory
    
    Args:
        request: FolderRequest containing folder_name
        
    Returns:
        A response indicating success or failure
    """
    # Check if user is admin
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only administrators can create folders")
        
    folder_name = request.folder_name.strip()
    
    if not folder_name:
        raise HTTPException(status_code=400, detail="Folder name cannot be empty")
        
    folder_path = os.path.join(DATA_DIR, folder_name)
    
    if os.path.exists(folder_path):
        raise HTTPException(status_code=400, detail=f"Folder '{folder_name}' already exists")
        
    try:
        os.makedirs(folder_path)
        logger.info(f"Created folder: {folder_path}")
        
        return {
            "success": True,
            "message": f"Folder '{folder_name}' created successfully",
            "folder_name": folder_name
        }
    except Exception as e:
        logger.error(f"Error creating folder: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error creating folder: {str(e)}")

@router.delete("/delete-folder/{folder_name:path}", response_model=Dict[str, Any])
async def delete_folder(folder_name: str, delete_files: bool = Query(True), current_user: dict = Depends(get_current_user)):
    """
    Delete a folder from the data directory
    
    Args:
        folder_name: The name of the folder to delete (can include path for subfolders)
        delete_files: Whether to delete the files in the folder
        
    Returns:
        A response indicating success or failure
    """
    # Check if user is admin
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only administrators can delete folders")
        
    # Xử lý subfolder
    if "/" in folder_name:
        # Đây là subfolder, cần xử lý đường dẫn đặc biệt
        folder_parts = folder_name.split("/")
        # Bắt đầu từ DATA_DIR và xây dựng đường dẫn dựa trên các phần của folder
        current_path = DATA_DIR
        for part in folder_parts:
            current_path = os.path.join(current_path, part)
        folder_path = current_path
    else:
        # Đây là folder thông thường
        folder_path = os.path.join(DATA_DIR, folder_name)
    
    if not os.path.exists(folder_path) or not os.path.isdir(folder_path):
        raise HTTPException(status_code=404, detail=f"Folder '{folder_name}' not found")
        
    try:
        if delete_files:
            # Delete the folder and all its contents
            shutil.rmtree(folder_path)
            logger.info(f"Deleted folder and contents: {folder_path}")
            
            return {
                "success": True,
                "message": f"Folder '{folder_name}' and all its contents deleted successfully"
            }
        else:
            # Move files to default folder and delete the folder
            files_moved = 0
            
            for filename in os.listdir(folder_path):
                src_path = os.path.join(folder_path, filename)
                dst_path = os.path.join(DATA_DIR, filename)
                
                if os.path.isfile(src_path):
                    # If file with same name exists in default, add a suffix
                    if os.path.exists(dst_path):
                        name, ext = os.path.splitext(filename)
                        dst_path = os.path.join(DATA_DIR, f"{name}_{datetime.now().strftime('%Y%m%d%H%M%S')}{ext}")
                    
                    shutil.move(src_path, dst_path)
                    files_moved += 1
            
            # Now delete the empty folder
            os.rmdir(folder_path)
            
            logger.info(f"Moved {files_moved} files to default folder and deleted folder: {folder_path}")
            
            return {
                "success": True,
                "message": f"Moved {files_moved} files to default folder and deleted folder '{folder_name}'"
            }
    except Exception as e:
        logger.error(f"Error deleting folder: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error deleting folder: {str(e)}")

@router.put("/rename-folder", response_model=Dict[str, Any])
async def rename_folder(request: FolderRenameRequest, current_user: dict = Depends(get_current_user)):
    """
    Rename a folder in the data directory
    
    Args:
        request: FolderRenameRequest containing old_name and new_name
        
    Returns:
        A response indicating success or failure
    """
    # Check if user is admin
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only administrators can rename folders")
        
    old_name = request.old_name.strip()
    new_name = request.new_name.strip()
    
    if not new_name:
        raise HTTPException(status_code=400, detail="New folder name cannot be empty")
    
    # Xử lý subfolder trong đổi tên
    if "/" in old_name:
        # Đây là subfolder, cần xử lý đường dẫn đặc biệt
        old_folder_parts = old_name.split("/")
        # Bắt đầu từ DATA_DIR và xây dựng đường dẫn dựa trên các phần của folder
        old_path_current = DATA_DIR
        for part in old_folder_parts:
            old_path_current = os.path.join(old_path_current, part)
        old_path = old_path_current
        
        # Xử lý tên mới (giữ nguyên cấu trúc thư mục cha, chỉ đổi tên thư mục con cuối cùng)
        if "/" in new_name:
            # Nếu tên mới có cấu trúc thư mục, sử dụng nó trực tiếp
            new_folder_parts = new_name.split("/")
            new_path_current = DATA_DIR
            for part in new_folder_parts:
                new_path_current = os.path.join(new_path_current, part)
            new_path = new_path_current
        else:
            # Nếu tên mới không có cấu trúc thư mục, giữ nguyên cấu trúc cũ và chỉ thay đổi tên cuối
            parent_folder = "/".join(old_folder_parts[:-1])
            if parent_folder:
                new_folder_parts = parent_folder.split("/")
                new_path_current = DATA_DIR
                for part in new_folder_parts:
                    new_path_current = os.path.join(new_path_current, part)
                new_path = os.path.join(new_path_current, new_name)
            else:
                new_path = os.path.join(DATA_DIR, new_name)
    else:
        # Đây là folder thông thường
        old_path = os.path.join(DATA_DIR, old_name)
        new_path = os.path.join(DATA_DIR, new_name)
    
    if not os.path.exists(old_path) or not os.path.isdir(old_path):
        raise HTTPException(status_code=404, detail=f"Folder '{old_name}' not found")
        
    if os.path.exists(new_path):
        raise HTTPException(status_code=400, detail=f"Folder '{new_name}' already exists")
        
    try:
        os.rename(old_path, new_path)
        logger.info(f"Renamed folder: {old_name} -> {new_name}")
        
        return {
            "success": True,
            "message": f"Folder renamed from '{old_name}' to '{new_name}' successfully"
        }
    except Exception as e:
        logger.error(f"Error renaming folder: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error renaming folder: {str(e)}")

@router.post("/create-subfolder", response_model=Dict[str, Any])
async def create_subfolder(request: SubfolderRequest, current_user: dict = Depends(get_current_user)):
    """
    Create a new subfolder inside an existing folder
    
    Args:
        request: SubfolderRequest containing parent_folder and subfolder_name
        
    Returns:
        A response indicating success or failure
    """
    # Check if user is admin
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only administrators can create subfolders")
        
    parent_folder = request.parent_folder.strip()
    subfolder_name = request.subfolder_name.strip()
    
    if not parent_folder or not subfolder_name:
        raise HTTPException(status_code=400, detail="Parent folder and subfolder name cannot be empty")
    
    # Determine parent folder path
    parent_path = os.path.join(DATA_DIR, parent_folder)
    
    # Check if parent folder exists
    if not os.path.exists(parent_path) or not os.path.isdir(parent_path):
        raise HTTPException(status_code=404, detail=f"Parent folder '{parent_folder}' not found")
    
    # Create full path for the subfolder
    subfolder_path = os.path.join(parent_path, subfolder_name)
    
    # Check if subfolder already exists
    if os.path.exists(subfolder_path):
        raise HTTPException(status_code=400, detail=f"Subfolder '{subfolder_name}' already exists in '{parent_folder}'")
    
    try:
        # Create the subfolder
        os.makedirs(subfolder_path)
        logger.info(f"Created subfolder: {subfolder_path}")
        
        # Create the full folder path for response
        full_folder_name = f"{parent_folder}/{subfolder_name}"
        
        return {
            "success": True,
            "message": f"Subfolder '{subfolder_name}' created successfully in '{parent_folder}'",
            "folder_name": full_folder_name
        }
    except Exception as e:
        logger.error(f"Error creating subfolder: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error creating subfolder: {str(e)}")

# Thêm endpoint cho download file
@router.get("/download-file/{file_path:path}", response_class=FileResponse)
async def download_file_by_path(
    file_path: str = Path(..., description="Path to the file to download, can include folder/subfolder"),
    current_user: dict = Depends(get_current_user)
):
    """
    Download a file from the data directory by file path
    
    This endpoint allows administrators to download a file from the data directory.
    
    Args:
        file_path: Path to the file to download, can include folder/subfolder
        
    Returns:
        The file for download
    """
    # Check if user is admin
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only administrators can download training files")
    
    try:
        logger.info(f"Download request received for file path: {file_path}")
        
        # Handle URL decoding if needed
        import urllib.parse
        decoded_path = urllib.parse.unquote(file_path)
        logger.info(f"Decoded file path: {decoded_path}")
        
        # Split path into folder and filename
        if "/" not in decoded_path:
            # File in root data directory or single folder
            full_file_path = os.path.join(DATA_DIR, decoded_path)
        else:
            # File in subfolder - build path properly
            path_parts = decoded_path.split("/")
            current_path = DATA_DIR
            for part in path_parts:
                current_path = os.path.join(current_path, part)
            full_file_path = current_path
        
        logger.info(f"Full file path constructed: {full_file_path}")
        
        # Check if file exists
        if not os.path.exists(full_file_path):
            logger.error(f"File not found: {full_file_path}")
            raise HTTPException(status_code=404, detail=f"File {decoded_path} not found")
        
        if not os.path.isfile(full_file_path):
            logger.error(f"Path is not a file: {full_file_path}")
            raise HTTPException(status_code=400, detail=f"Path {decoded_path} is not a file")
        
        logger.info(f"Serving file for download: {full_file_path}")
        
        # Get filename for Content-Disposition header
        filename = os.path.basename(full_file_path)
        
        # Encode filename for Content-Disposition header to handle Unicode characters
        # Use URL encoding for filename to avoid latin-1 encoding issues
        from urllib.parse import quote
        encoded_filename = quote(filename, safe='')
        
        # Try to create a safe ASCII-only filename as fallback
        try:
            safe_filename = filename.encode('ascii', 'ignore').decode('ascii')
            if not safe_filename:
                safe_filename = 'download_file'
        except:
            safe_filename = 'download_file'
        
        # Return file for download with proper headers using both formats for compatibility
        return FileResponse(
            path=full_file_path, 
            filename=filename,
            media_type="application/octet-stream",
            headers={
                "Content-Disposition": f"attachment; filename=\"{safe_filename}\"; filename*=UTF-8''{encoded_filename}"
            }
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error downloading file: {str(e)}")
        logger.error(f"Exception details: {type(e).__name__}: {e}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Error downloading file: {str(e)}")

# Legacy endpoint for backward compatibility
@router.get("/download-training-file/{filename}", response_class=FileResponse)
async def download_training_file(
    filename: str,
    folder: str = Query("default", description="Folder containing the file"),
    current_user: dict = Depends(get_current_user)
):
    """
    Download a file from the data directory
    
    This endpoint allows administrators to download training files.
    
    Args:
        filename: The name of the file to download
        folder: The folder containing the file (default: "default")
        
    Returns:
        The file content
    """
    # Check if user is admin
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only administrators can download training files")
    
    try:
        # Determine folder path - always use subfolders, no more root DATA_DIR storage
        if "/" in folder:
            # Đây là subfolder, cần xử lý đường dẫn đặc biệt
            folder_parts = folder.split("/")
            # Bắt đầu từ DATA_DIR và xây dựng đường dẫn dựa trên các phần của folder
            current_path = DATA_DIR
            for part in folder_parts:
                current_path = os.path.join(current_path, part)
            folder_path = current_path
        else:
            # Tất cả folders đều là subfolders của DATA_DIR, kể cả "default"
            folder_path = os.path.join(DATA_DIR, folder)
            
        file_path = os.path.join(folder_path, filename)
        
        # Check if file exists
        if not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail=f"File {filename} not found in folder {folder}")
        
        logger.info(f"Downloading file: {file_path}")
        
        return FileResponse(
            path=file_path, 
            filename=filename,
            media_type='application/octet-stream'
        )
    
    except Exception as e:
        logger.error(f"Error downloading training file: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error downloading file: {str(e)}")

# File content model
class FileContentRequest(BaseModel):
    """Request model for updating file content"""
    content: str = Field(..., description="New content for the file")

class EditFileRequest(BaseModel):
    """Request model for editing a file"""
    file_path: str = Field(..., description="Path to the file to edit, can include folder/subfolder")
    content: str = Field(..., description="New content for the file")

# Thêm endpoint cho edit file (chỉ hỗ trợ file text)
@router.get("/get-file-content/{filename}", response_model=Dict[str, Any])
async def get_file_content(
    filename: str,
    folder: str = Query("default", description="Folder containing the file"),
    current_user: dict = Depends(get_current_user)
):
    """
    Get the content of a text file from the data directory
    
    This endpoint allows administrators to get the content of a text file for editing.
    Only text files (.txt) are supported.
    
    Args:
        filename: The name of the file to get content from
        folder: The folder containing the file (default: "default")
        
    Returns:
        The file content
    """
    # Check if user is admin
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only administrators can edit training files")
    
    try:
        # Determine folder path - always use subfolders, no more root DATA_DIR storage
        if "/" in folder:
            # Đây là subfolder, cần xử lý đường dẫn đặc biệt
            folder_parts = folder.split("/")
            # Bắt đầu từ DATA_DIR và xây dựng đường dẫn dựa trên các phần của folder
            current_path = DATA_DIR
            for part in folder_parts:
                current_path = os.path.join(current_path, part)
            folder_path = current_path
        else:
            # Tất cả folders đều là subfolders của DATA_DIR, kể cả "default"
            folder_path = os.path.join(DATA_DIR, folder)
            
        file_path = os.path.join(folder_path, filename)
        
        # Check if file exists
        if not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail=f"File {filename} not found in folder {folder}")
        
        # Check if file is a text file
        file_ext = os.path.splitext(filename)[1].lower()
        if file_ext != '.txt':
            raise HTTPException(status_code=400, detail="Only text files (.txt) can be edited")
        
        logger.info(f"Getting content of file: {file_path}")
        
        # Read file content
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
        
        return {
            "success": True,
            "filename": filename,
            "folder": folder,
            "content": content
        }
    
    except Exception as e:
        logger.error(f"Error getting file content: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error getting file content: {str(e)}")

@router.put("/edit-file", response_model=Dict[str, Any])
async def update_file_content(
    request: EditFileRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    Update the content of a text file in the data directory
    
    This endpoint allows administrators to update the content of a text file.
    Only text files (.txt) are supported.
    
    Args:
        request: EditFileRequest containing the file path and new content
        
    Returns:
        Success message
    """
    # Check if user is admin
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only administrators can edit training files")
    
    try:
        path = request.file_path
        
        # Split path into folder and filename
        # If path has no slashes, assume it's a file in the root data directory
        if "/" not in path:
            filename = path
            folder_path = DATA_DIR
        else:
            # Split by last slash to get folder path and filename
            *folder_parts, filename = path.split("/")
            folder = "/".join(folder_parts)
            
            # Determine folder path
            if folder == "default" or not folder:
                folder_path = DATA_DIR
            else:
                # Xây dựng đường dẫn dựa trên các phần của folder
                current_path = DATA_DIR
                for part in folder_parts:
                    current_path = os.path.join(current_path, part)
                folder_path = current_path
                
        file_path = os.path.join(folder_path, filename)
        
        # Check if file exists
        if not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail=f"File {filename} not found in folder {folder}")
        
        # Check if file is a text file
        file_ext = os.path.splitext(filename)[1].lower()
        if file_ext != '.txt':
            raise HTTPException(status_code=400, detail="Only text files (.txt) can be edited")
        
        logger.info(f"Updating content of file: {file_path}")
        
        # Write new content to file
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(request.content)
        
        return {
            "success": True,
            "message": f"File content updated successfully"
        }
    
    except Exception as e:
        logger.error(f"Error updating file content: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error updating file content: {str(e)}")

@router.get("/list-folders", response_model=Dict[str, Any])
async def list_folders(current_user: dict = Depends(get_current_user)):
    """
    List available folders for file upload/management
    Returns all department folders including 'default' folder
    
    Returns:
        A response containing a list of available folders (all folders including default)
    """
    # Check if user is admin
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only administrators can view folders")
    
    try:
        folders = []
        
        # Scan for all folders including 'default' folder
        if os.path.exists(DATA_DIR):
            for item in os.listdir(DATA_DIR):
                item_path = os.path.join(DATA_DIR, item)
                if os.path.isdir(item_path) and not item.startswith('.') and item != '__pycache__':
                    folders.append(item)
        
        logger.info(f"Available folders: {folders}")
        
        return {
            "success": True,
            "folders": folders,
            "count": len(folders)
        }
    
    except Exception as e:
        logger.error(f"Error listing folders: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error listing folders: {str(e)}")
