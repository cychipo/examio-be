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

# Fallback OCR services
import pytesseract
from pdf2image import convert_from_path
from pypdf import PdfReader
import io

FALLBACK_AVAILABLE = True
logger_msg = "Built-in Tesseract OCR fallback is available"

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
            result = subprocess.run(check_cmd, capture_output=True, text=True, timeout=30)
            if result.returncode != 0:
                logger.error(f"olmocr check failed with return code: {result.returncode}")
                logger.error(f"olmocr STDOUT: {result.stdout}")
                logger.error(f"olmocr STDERR: {result.stderr}")
                raise RuntimeError(f"olmocr check failed: {result.stderr}")
            logger.info("olmocr is available and working")
        except subprocess.TimeoutExpired as e:
            logger.error(f"olmocr check timed out after 30s: {e}")
            raise RuntimeError("olmocr check timed out")
        except FileNotFoundError as e:
            logger.error(f"olmocr module not found: {e}")
            raise RuntimeError(f"olmocr module not found: {e}")
        except Exception as e:
            logger.error(f"olmocr check failed with exception: {type(e).__name__}: {e}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            raise RuntimeError(f"olmocr not available: {e}")

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
    Fallback OCR method using Tesseract directly
    """
    logger.info(f"Running fallback OCR (Tesseract) for: {pdf_path}")
    try:
        # Get page count
        reader = PdfReader(str(pdf_path))
        page_count = len(reader.pages)
        
        # Convert PDF to images
        images = convert_from_path(str(pdf_path))
        
        full_text = []
        for i, image in enumerate(images):
            logger.info(f"Processing page {i+1}/{page_count} with Tesseract")
            # Run OCR on each page
            text = pytesseract.image_to_string(image, lang='vie+eng')
            full_text.append(f"## Trang {i+1}\n\n{text}")
            
        logger.info(f"Fallback OCR completed successfully ({page_count} pages)")
        return "\n\n".join(full_text), page_count
    except Exception as e:
        logger.error(f"Fallback OCR failed: {str(e)}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
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
        "src.backend.main:app",
        host="0.0.0.0",
        port=port,
        reload=True,
        reload_dirs=["/app"]
    )
