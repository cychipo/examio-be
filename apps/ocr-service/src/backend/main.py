# -*- coding: utf-8 -*-
"""
OCR Service - Python Backend
Microservice xử lý OCR sử dụng olmocr
"""

import os
import uuid
import subprocess
import shutil
import logging
import sys
from pathlib import Path
from typing import Optional, Tuple

from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

# Try to import fallback OCR services
try:
    # Add ai-service src to path if needed to reuse PdfOcrService
    AI_SERVICE_SRC = Path(__file__).parent.parent.parent.parent / "ai-service" / "src"
    if AI_SERVICE_SRC.exists():
        sys.path.append(str(AI_SERVICE_SRC))

    from backend.services.pdf_ocr_service import pdf_ocr_service
    FALLBACK_AVAILABLE = True
    logger_msg = "Fallback OCR (Tesseract) is available"
except ImportError:
    FALLBACK_AVAILABLE = False
    logger_msg = "Fallback OCR (Tesseract) is NOT available"

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)
logger.info(logger_msg)

# FastAPI App Setup
app = FastAPI(
    title="OCR Service",
    description="OCR microservice using olmocr with Tesseract fallback",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create upload and output directories
UPLOAD_DIR = Path("/app/apps/ocr-service/uploads")
OUTPUT_DIR = Path("/app/apps/ocr-service/outputs")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def run_olmocr(pdf_path: Path, output_dir: Path) -> tuple[Path, int]:
    """
    Chạy olmocr pipeline để xử lý PDF
    """
    try:
        olmocr_path = os.getenv("OLMOCR_PATH")

        # Check if olmocr is installed/available
        # We try to run it with --help first to see if it exists
        check_cmd = ["python", "-m", "olmocr.pipeline", "--help"]
        try:
            subprocess.run(check_cmd, capture_output=True, check=True, timeout=10)
        except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
            logger.warning("olmocr is not found or not working correctly. Failing over.")
            raise RuntimeError("olmocr not available")

        cmd = [
            "python",
            "-m",
            "olmocr.pipeline",
            str(output_dir),
            "--pdfs",
            str(pdf_path),
            "--markdown"
        ]

        env = os.environ.copy()
        if olmocr_path:
            # Normalize path for current OS
            olmocr_path = os.path.normpath(olmocr_path)
            
            # Check if path exists
            if not os.path.isdir(olmocr_path):
                logger.warning(f"OLMOCR_PATH does not exist: {olmocr_path}")
            else:
                logger.info(f"OLMOCR_PATH verified: {olmocr_path}")
            
            # Use os.pathsep for cross-platform compatibility (`;` on Windows, `:` on Unix)
            env["PYTHONPATH"] = f"{olmocr_path}{os.pathsep}{env.get('PYTHONPATH', '')}"
            logger.info(f"Using OLMOCR_PATH: {olmocr_path}")

        logger.info(f"Running olmocr: {' '.join(cmd)}")

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            check=True,
            timeout=600,  # Extended to 10 minutes for large PDFs
            env=env
        )

        logger.info("olmocr completed successfully")

        markdown_dir = output_dir / "markdown"
        pdf_name = pdf_path.stem
        markdown_file = markdown_dir / f"{pdf_name}.md"

        if not markdown_file.exists():
            raise RuntimeError(f"Markdown file not found: {markdown_file}")

        page_count = 0
        dolma_dir = output_dir / "documents"
        if dolma_dir.exists():
            page_count = len(list(dolma_dir.glob("*.json.gz")))

        return markdown_file, page_count

    except Exception as e:
        logger.error(f"olmocr failed: {str(e)}")
        raise RuntimeError(f"olmocr failed: {str(e)}")


def run_fallback_ocr(pdf_path: Path) -> Tuple[str, int]:
    """
    Fallback OCR method using Tesseract
    """
    if not FALLBACK_AVAILABLE:
        raise RuntimeError("Fallback OCR service not available")

    logger.info(f"Running fallback OCR for: {pdf_path}")
    try:
        with open(pdf_path, "rb") as f:
            pdf_bytes = f.read()

        # Use PdfOcrService from ai-service
        text = pdf_ocr_service.extract_text_from_pdf(pdf_bytes)

        # Try to get page count
        from pypdf import PdfReader
        import io
        reader = PdfReader(io.BytesIO(pdf_bytes))
        page_count = len(reader.pages)

        logger.info(f"Fallback OCR completed successfully ({page_count} pages)")
        return text, page_count
    except Exception as e:
        logger.error(f"Fallback OCR failed: {str(e)}")
        raise RuntimeError(f"Fallback OCR failed: {str(e)}")


@app.post("/api/ocr/process")
async def process_pdf(
    file: UploadFile = File(...),
    user_id: Optional[str] = Form(None)
) -> JSONResponse:
    job_id = str(uuid.uuid4())
    pdf_path = None

    try:
        if not file or not file.filename:
            raise HTTPException(status_code=400, detail="Invalid file")

        logger.info(f"--- Starting OCR Job: {job_id} ---")

        # Save file
        pdf_filename = f"{job_id}_{file.filename}"
        pdf_path = UPLOAD_DIR / pdf_filename
        with open(pdf_path, "wb") as f:
            content = await file.read()
            f.write(content)

        # 1. Attempt olmocr (Preferred)
        try:
            logger.info(f"Attempting primary method: olmocr")
            job_output_dir = OUTPUT_DIR / job_id
            job_output_dir.mkdir(exist_ok=True)

            markdown_file, page_count = run_olmocr(pdf_path, job_output_dir)

            with open(markdown_file, "r", encoding="utf-8") as f:
                content = f.read()

            logger.info(f"SUCCESS: Primary method (olmocr) worked for {job_id}")
            return JSONResponse(content={
                "success": True,
                "job_id": job_id,
                "content": content,
                "page_count": page_count,
                "method": "olmocr"
            })

        except Exception as primary_error:
            logger.warning(f"PRIMARY METHOD FAILED: {str(primary_error)}")

            # 2. Fallback to Tesseract
            if FALLBACK_AVAILABLE:
                logger.info(f"Attempting fallback method: Tesseract")
                try:
                    content, page_count = run_fallback_ocr(pdf_path)
                    logger.info(f"SUCCESS: Fallback method (Tesseract) worked for {job_id}")
                    return JSONResponse(content={
                        "success": True,
                        "job_id": job_id,
                        "content": content,
                        "page_count": page_count,
                        "method": "tesseract_fallback"
                    })
                except Exception as fallback_error:
                    logger.error(f"FALLBACK METHOD FAILED: {str(fallback_error)}")
                    raise HTTPException(status_code=500, detail=f"All OCR methods failed. Primary: {str(primary_error)}, Fallback: {str(fallback_error)}")
            else:
                logger.error("No fallback available and primary method failed.")
                raise HTTPException(status_code=500, detail=f"OCR failed and no fallback available. Error: {str(primary_error)}")

    except HTTPException:
        raise
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"success": False, "job_id": job_id, "error_message": str(e)}
        )
    finally:
        # Optional: Cleanup if needed, but keeping for now for logs
        pass


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
