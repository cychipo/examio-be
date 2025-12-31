"""Backend services package"""

from .ocr_service import ocr_service, OCRProcessingService, FileInfo, DocumentChunk

__all__ = ['ocr_service', 'OCRProcessingService', 'FileInfo', 'DocumentChunk']
