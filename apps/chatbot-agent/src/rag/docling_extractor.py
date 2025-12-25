"""
IBM Docling text extraction utility

This module provides text extraction functionality using IBM Docling library.
Supports PDF, DOCX, and other document formats.
"""

import logging
from typing import Optional
from pathlib import Path

try:
    from docling.document_converter import DocumentConverter
    DOCLING_AVAILABLE = True
except ImportError:
    DOCLING_AVAILABLE = False
    logging.warning("Docling not available. Install with: pip install docling")

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def extract_text_with_docling(file_path: str) -> Optional[str]:
    """
    Extract text from a document using IBM Docling
    
    Args:
        file_path: Path to the document file
        
    Returns:
        Extracted text content or None if extraction fails
    """
    if not DOCLING_AVAILABLE:
        logger.error("Docling is not installed. Cannot extract text.")
        return None
    
    try:
        logger.info(f"Extracting text from {file_path} using Docling...")
        
        # Initialize DocumentConverter
        converter = DocumentConverter()
        
        # Convert document
        result = converter.convert(file_path)
        
        # Extract text content
        if result and result.document:
            text = result.document.export_to_markdown()
            logger.info(f"Successfully extracted {len(text)} characters from {file_path}")
            return text
        else:
            logger.warning(f"No content extracted from {file_path}")
            return None
            
    except Exception as e:
        logger.error(f"Error extracting text with Docling from {file_path}: {str(e)}")
        return None


def is_docling_available() -> bool:
    """Check if Docling library is available"""
    return DOCLING_AVAILABLE
