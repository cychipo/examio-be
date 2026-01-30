"""
PDF OCR Service - Port từ NestJS pdf.service.ts

Flow giống be-main:
1. splitPdfToChunks: Chia PDF thành chunks (mỗi 10 pages) dùng PyPDF2/pypdf
2. ocrPdf: Convert PDF pages → images → OCR bằng Tesseract
3. Trả về text đã OCR

Dependencies:
- pypdf hoặc PyPDF2: Split PDF
- pdf2image: Convert PDF → images
- pytesseract: OCR
- Pillow: Image processing
"""

import os
import io
import tempfile
import logging
import requests
from typing import List, Tuple, Optional
from pathlib import Path

logger = logging.getLogger(__name__)

# Check available libraries
try:
    from pypdf import PdfReader, PdfWriter
    PYPDF_AVAILABLE = True
    logger.info("Using pypdf for PDF processing")
except ImportError:
    try:
        from PyPDF2 import PdfReader, PdfWriter
        PYPDF_AVAILABLE = True
        logger.info("Using PyPDF2 for PDF processing")
    except ImportError:
        PYPDF_AVAILABLE = False
        logger.warning("Neither pypdf nor PyPDF2 available")

try:
    from pdf2image import convert_from_bytes, convert_from_path
    PDF2IMAGE_AVAILABLE = True
except ImportError:
    PDF2IMAGE_AVAILABLE = False
    logger.warning("pdf2image not available - OCR will not work for scanned PDFs")

try:
    import pytesseract
    from PIL import Image
    TESSERACT_AVAILABLE = True
except ImportError:
    TESSERACT_AVAILABLE = False
    logger.warning("pytesseract not available - OCR will not work")


class PdfOcrService:
    """
    PDF OCR Service - giống pdf.service.ts trong be-main

    Flow:
    1. Split PDF thành chunks (mỗi chunk N pages)
    2. Convert mỗi chunk → images
    3. OCR images bằng Tesseract
    """

    CHUNK_SIZE = 10  # pages per chunk, giống be-main
    DPI = 300  # Higher DPI = better OCR quality

    def __init__(self):
        self._check_dependencies()
        self.ocr_service_url = os.getenv("OCR_SERVICE_URL", "http://ocr-service:8003/api/ocr/process")

    def _check_dependencies(self):
        """Check if required dependencies are available"""
        if not PYPDF_AVAILABLE:
            logger.error("PDF library not available. Install: pip install pypdf")
        if not PDF2IMAGE_AVAILABLE:
            logger.error("pdf2image not available. Install: pip install pdf2image")
            logger.error("Also need poppler: brew install poppler (macOS) or apt install poppler-utils (Linux)")
        if not TESSERACT_AVAILABLE:
            logger.error("pytesseract not available. Install: pip install pytesseract pillow")
            logger.error("Also need tesseract: brew install tesseract tesseract-lang (macOS)")

    def split_pdf_to_chunks(self, pdf_bytes: bytes, chunk_size: int = None) -> List[bytes]:
        """
        Split PDF thành nhiều chunks, mỗi chunk có chunk_size pages
        Giống splitPdfToChunks trong be-main

        Args:
            pdf_bytes: PDF file content
            chunk_size: Number of pages per chunk (default: 10)

        Returns:
            List of PDF chunk bytes
        """
        if not PYPDF_AVAILABLE:
            raise RuntimeError("PDF library not available")

        chunk_size = chunk_size or self.CHUNK_SIZE

        try:
            logger.info("🔧 Starting PDF splitting...")

            # Read PDF
            pdf_reader = PdfReader(io.BytesIO(pdf_bytes))
            total_pages = len(pdf_reader.pages)

            if total_pages == 0:
                raise ValueError("PDF has no pages")

            logger.info(f"📄 PDF has {total_pages} pages, chunk_size={chunk_size}")

            chunks: List[bytes] = []

            for i in range(0, total_pages, chunk_size):
                end = min(i + chunk_size, total_pages)

                try:
                    # Create new PDF with selected pages
                    pdf_writer = PdfWriter()
                    for page_num in range(i, end):
                        pdf_writer.add_page(pdf_reader.pages[page_num])

                    # Write to bytes
                    output = io.BytesIO()
                    pdf_writer.write(output)
                    chunk_bytes = output.getvalue()

                    if len(chunk_bytes) > 0:
                        chunks.append(chunk_bytes)
                        logger.debug(f"✅ Created chunk {len(chunks)}: pages {i+1}-{end}")

                except Exception as e:
                    logger.error(f"❌ Error creating chunk {i+1}-{end}: {e}")
                    continue

            if not chunks:
                raise ValueError("No valid chunks created")

            logger.info(f"🎯 Successfully created {len(chunks)} chunks")
            return chunks

        except Exception as e:
            logger.error(f"❌ Error splitting PDF: {e}")
            raise

    def _call_external_ocr_service(self, pdf_bytes: bytes) -> Optional[str]:
        """Gọi OCR microservice bên ngoài (olmocr)"""
        try:
            logger.info(f"🚀 Calling external OCR service at {self.ocr_service_url}")
            files = {'file': ('document.pdf', pdf_bytes, 'application/pdf')}
            response = requests.post(self.ocr_service_url, files=files, timeout=300) # 5 min timeout
            
            if response.status_code == 200:
                data = response.json()
                if data.get("success") and data.get("content"):
                    logger.info("✅ External OCR service success!")
                    return data.get("content")
                else:
                    logger.warning(f"⚠️ External OCR service returned failure: {data.get('error_message')}")
            else:
                logger.warning(f"⚠️ External OCR service returned status {response.status_code}")
        except Exception as e:
            logger.error(f"❌ Failed to reach external OCR service: {e}")
        
        return None

    def ocr_pdf(self, pdf_bytes: bytes, language: str = 'eng+vie', use_preprocessing: bool = True) -> str:
        """
        OCR một PDF chunk. Ưu tiên dùng ocr-service bên ngoài, fallback về Tesseract local.
        """
        # 1. Thử gọi ocr-service bên ngoài (olmocr)
        external_content = self._call_external_ocr_service(pdf_bytes)
        if external_content:
            return external_content

        # 2. Nếu fail, fallback về Tesseract local
        logger.info("↩️ Falling back to local Tesseract OCR...")
        
        if not PDF2IMAGE_AVAILABLE:
            raise RuntimeError("pdf2image not available. Install: pip install pdf2image")
        if not TESSERACT_AVAILABLE:
            raise RuntimeError("pytesseract not available. Install: pip install pytesseract")

        try:
            logger.info("📷 Converting PDF to images for Tesseract...")
            # Convert PDF pages to images at high DPI
            images = convert_from_bytes(
                pdf_bytes,
                dpi=self.DPI,
                fmt='png'
            )

            logger.info(f"📄 Converted {len(images)} pages to images")

            # Import preprocessing service
            preprocessing_service = None
            if use_preprocessing:
                try:
                    from backend.services.image_preprocessing_service import get_image_preprocessing_service
                    preprocessing_service = get_image_preprocessing_service()
                except Exception as e:
                    logger.warning(f"⚠️ Image preprocessing not available: {e}")

            full_text = []
            import numpy as np
            import cv2

            for i, pil_image in enumerate(images):
                try:
                    image_np = np.array(pil_image)
                    if len(image_np.shape) == 3:
                        image_np = cv2.cvtColor(image_np, cv2.COLOR_RGB2BGR)

                    if preprocessing_service:
                        processed_image = preprocessing_service.preprocess_image(image_np)
                    else:
                        processed_image = image_np

                    if len(processed_image.shape) == 2:
                        pil_processed = Image.fromarray(processed_image)
                    else:
                        pil_processed = Image.fromarray(cv2.cvtColor(processed_image, cv2.COLOR_BGR2RGB))

                    text = pytesseract.image_to_string(
                        pil_processed,
                        lang=language,
                        config='--psm 6 --oem 3'
                    )

                    if text.strip():
                        full_text.append(text.strip())
                except Exception as e:
                    logger.error(f"❌ Error Tesseract page {i+1}: {e}")
                    continue

            result = '\n'.join(full_text)
            logger.info(f"✅ Tesseract OCR completed: {len(result)} characters")
            return result

        except Exception as e:
            logger.error(f"❌ Both external and local OCR failed: {e}")
            raise

    def ocr_pdf_basic(self, pdf_bytes: bytes, language: str = 'eng+vie') -> str:
        """
        Basic OCR without preprocessing - faster but lower quality.
        Use for PDFs with clear text.
        """
        return self.ocr_pdf(pdf_bytes, language, use_preprocessing=False)

    def extract_text_from_pdf(self, pdf_bytes: bytes) -> str:
        """
        Try to extract text directly from PDF first (for digital PDFs)
        If no text found, fall back to OCR

        Args:
            pdf_bytes: PDF content

        Returns:
            Extracted text
        """
        if not PYPDF_AVAILABLE:
            raise RuntimeError("PDF library not available")

        try:
            # First try direct text extraction
            pdf_reader = PdfReader(io.BytesIO(pdf_bytes))
            text_parts = []

            for page in pdf_reader.pages:
                page_text = page.extract_text()
                if page_text and page_text.strip():
                    text_parts.append(page_text.strip())

            direct_text = '\n'.join(text_parts)

            # If we got substantial text, return it
            if len(direct_text) > 100:  # Arbitrary threshold
                logger.info(f"📝 Extracted {len(direct_text)} chars directly from PDF")
                return direct_text

            # Otherwise, fall back to OCR
            logger.info("📷 Direct extraction yielded little text, trying OCR...")
            return self.ocr_pdf(pdf_bytes)

        except Exception as e:
            logger.error(f"Error in extract_text_from_pdf: {e}")
            # Fall back to OCR
            return self.ocr_pdf(pdf_bytes)

    def process_pdf_with_chunks(
        self,
        pdf_bytes: bytes,
        chunk_size: int = None
    ) -> List[Tuple[int, str]]:
        """
        Process PDF: split into chunks and extract text from each
        Giống extractAndSavePdfChunks trong be-main

        Args:
            pdf_bytes: PDF content
            chunk_size: Pages per chunk

        Returns:
            List of (chunk_index, text) tuples
        """
        chunk_size = chunk_size or self.CHUNK_SIZE

        logger.info("📄 Starting PDF processing with chunks...")

        # Split PDF into chunks
        chunks = self.split_pdf_to_chunks(pdf_bytes, chunk_size)

        results: List[Tuple[int, str]] = []
        success_count = 0
        error_count = 0

        for i, chunk_bytes in enumerate(chunks):
            try:
                # Extract text from chunk (try direct first, then OCR)
                text = self.extract_text_from_pdf(chunk_bytes)

                if text and text.strip():
                    results.append((i + 1, text.strip()))
                    success_count += 1
                    logger.info(f"✅ Chunk {i+1}/{len(chunks)}: {len(text)} chars")
                else:
                    logger.warning(f"⚠️ Chunk {i+1}: Empty text")
                    error_count += 1

            except Exception as e:
                logger.error(f"❌ Chunk {i+1} failed: {e}")
                error_count += 1
                continue

        logger.info(f"📊 PDF processing done: {success_count} success, {error_count} errors")

        if not results:
            raise ValueError("No text could be extracted from PDF")

        return results


# Singleton instance
pdf_ocr_service = PdfOcrService()
