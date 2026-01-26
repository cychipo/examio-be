# -*- coding: utf-8 -*-
"""
OCR Service - Python Backend
Microservice xử lý OCR sử dụng olmocr
"""

import os
import uuid
import subprocess
import shutil
from pathlib import Path
from typing import Optional
import logging

from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# Khởi tạo FastAPI app với unlimited file size
app = FastAPI(
    title="OCR Service Backend",
    description="OCR processing using olmocr",
    version="1.0.0"
)

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Cấu trúc thư mục
BASE_DIR = Path(__file__).parent.parent
UPLOAD_DIR = BASE_DIR / "uploads"
OUTPUT_DIR = BASE_DIR / "outputs"

# Tạo thư mục nếu chưa tồn tại
UPLOAD_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)

# Allowed MIME types for PDF
ALLOWED_PDF_MIMES = {
    "application/pdf",
    "application/x-pdf",
}


def validate_pdf_file(file: UploadFile, file_path: Path) -> tuple[bool, str]:
    """
    Validate PDF file với nhiều checks

    Returns:
        Tuple of (is_valid, error_message)
    """
    # Check 1: Filename extension
    if not file.filename.lower().endswith(".pdf"):
        return False, "File must have .pdf extension"

    # Check 2: Content-Type header
    content_type = file.content_type
    if content_type and content_type not in ALLOWED_PDF_MIMES:
        return False, f"Invalid content type: {content_type}. Must be application/pdf"

    # Check 3: Magic number (file signature)
    try:
        with open(file_path, "rb") as f:
            header = f.read(4)
            if header != b"%PDF":
                return False, "Invalid PDF file signature"
    except Exception as e:
        return False, f"Error reading file: {str(e)}"

    return True, ""


def run_olmocr(pdf_path: Path, output_dir: Path) -> tuple[Path, int]:
    """
    Chạy olmocr pipeline để xử lý PDF

    Args:
        pdf_path: Đường dẫn đến file PDF
        output_dir: Thư mục lưu output

    Returns:
        Tuple of (markdown_file_path, page_count)

    Raises:
        RuntimeError: Nếu subprocess thất bại
    """
    try:
        # Xác định đường dẫn đến olmocr
        # Option 1: Sử dụng OLMOCR_PATH từ env
        # Option 2: Giả định olmocr đã được cài vào venv
        olmocr_path = os.getenv("OLMOCR_PATH")

        if olmocr_path:
            # Chạy olmocr từ repo local
            cmd = [
                "python",
                "-m",
                "olmocr.pipeline",
                str(output_dir),
                "--pdfs",
                str(pdf_path),
                "--markdown"
            ]

            # Thêm PYTHONPATH để import olmocr
            env = os.environ.copy()
            env["PYTHONPATH"] = f"{olmocr_path}:{env.get('PYTHONPATH', '')}"
        else:
            # Sử dụng olmocr đã cài trong venv
            cmd = [
                "python",
                "-m",
                "olmocr.pipeline",
                str(output_dir),
                "--pdfs",
                str(pdf_path),
                "--markdown"
            ]
            env = None

        logger.info(f"Running olmocr: {' '.join(cmd)}")
        if olmocr_path:
            logger.info(f"Using OLMOCR_PATH: {olmocr_path}")

        # Chạy subprocess với encoding UTF-8
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            check=True,
            timeout=300,  # 5 minutes timeout
            env=env
        )

        logger.info(f"olmocr completed successfully")

        # File markdown output sẽ nằm trong <output_dir>/markdown/<tên_file>.md
        markdown_dir = output_dir / "markdown"
        pdf_name = pdf_path.stem
        markdown_file = markdown_dir / f"{pdf_name}.md"

        if not markdown_file.exists():
            raise RuntimeError(f"Markdown file không được tạo: {markdown_file}")

        # Estimate page count from dolma output if available
        page_count = 0
        dolma_dir = output_dir / "documents"
        if dolma_dir.exists():
            # Count JSON files as approximation
            page_count = len(list(dolma_dir.glob("*.json.gz")))

        return markdown_file, page_count

    except subprocess.TimeoutExpired:
        raise RuntimeError("OCR processing timeout (>5 minutes)")
    except subprocess.CalledProcessError as e:
        error_msg = f"olmocr subprocess failed: {e.stderr}"
        logger.error(error_msg)
        raise RuntimeError(error_msg)
    except Exception as e:
        logger.error(f"Unexpected error: {str(e)}")
        raise RuntimeError(f"Error running olmocr: {str(e)}")


@app.post("/api/ocr/process")
async def process_pdf(
    file: UploadFile = File(...),
    user_id: Optional[str] = Form(None)
) -> JSONResponse:
    """
    Endpoint xử lý OCR cho PDF

    Args:
        file: PDF file upload
        user_id: Optional user ID for tracking

    Returns:
        JSON: {
            "success": bool,
            "job_id": str,
            "content": str,
            "page_count": int,
            "error_message": str
        }
    """
    job_id = str(uuid.uuid4())
    pdf_path = None
    job_output_dir = None

    try:
        # Validate file exists
        if not file:
            raise HTTPException(status_code=400, detail="No file uploaded")

        # Check filename is provided
        if not file.filename:
            raise HTTPException(status_code=400, detail="Filename is required")

        logger.info(f"Processing PDF: {file.filename} (job_id: {job_id})")

        # Lưu file PDF vào disk trước
        pdf_filename = f"{job_id}_{file.filename}"
        pdf_path = UPLOAD_DIR / pdf_filename

        with open(pdf_path, "wb") as f:
            content = await file.read()
            f.write(content)

        # Validate PDF với multiple checks
        is_valid, error_msg = validate_pdf_file(file, pdf_path)
        if not is_valid:
            # Xóa file invalid
            if pdf_path.exists():
                pdf_path.unlink()
            raise HTTPException(status_code=400, detail=error_msg)

        # Tạo output directory
        job_output_dir = OUTPUT_DIR / job_id
        job_output_dir.mkdir(exist_ok=True)

        # Run OCR
        markdown_file, page_count = run_olmocr(pdf_path, job_output_dir)

        # Đọc markdown content
        with open(markdown_file, "r", encoding="utf-8") as f:
            markdown_content = f.read()

        logger.info(f"OCR completed: {job_id} ({page_count} pages)")

        return JSONResponse(content={
            "success": True,
            "job_id": job_id,
            "content": markdown_content,
            "page_count": page_count,
            "error_message": ""
        })

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"OCR processing error: {str(e)}")
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "job_id": job_id,
                "content": "",
                "page_count": 0,
                "error_message": str(e)
            }
        )


@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "service": "OCR Service Backend",
        "status": "online",
        "version": "1.0.0"
    }


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "healthy": True,
        "message": "OCR service is running",
        "version": "1.0.0"
    }


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8003))
    logger.info(f"Starting OCR Service Backend on port {port}")
    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=port,
        reload=True
    )
