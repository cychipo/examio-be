"""
Utility module for reading different file formats
"""
import base64
import logging
from pathlib import Path
import io

logger = logging.getLogger(__name__)

def read_text_file(file_obj):
    """Read text from txt, md files"""
    try:
        return file_obj.read().decode('utf-8')
    except UnicodeDecodeError:
        try:
            # Try another common encoding
            return file_obj.read().decode('latin-1')
        except Exception as e:
            logger.error(f"Error reading text file: {str(e)}")
            raise Exception(f"Không thể đọc nội dung tệp. Lỗi: {str(e)}")

def read_pdf_file(file_obj):
    """Read text from PDF file"""
    try:
        import PyPDF2
        pdf_reader = PyPDF2.PdfReader(file_obj)
        text = ""
        for page in pdf_reader.pages:
            text += page.extract_text() + "\n"
        return text
    except ImportError:
        raise ImportError("Thư viện PyPDF2 không được cài đặt. Vui lòng cài đặt để đọc file PDF.")
    except Exception as e:
        logger.error(f"Error reading PDF file: {str(e)}")
        raise Exception(f"Không thể đọc file PDF. Lỗi: {str(e)}")

def read_docx_file(file_obj):
    """Read text from DOCX file"""
    try:
        import docx
        doc = docx.Document(file_obj)
        text = "\n".join([para.text for para in doc.paragraphs])
        return text
    except ImportError:
        raise ImportError("Thư viện python-docx không được cài đặt. Vui lòng cài đặt để đọc file DOCX.")
    except Exception as e:
        logger.error(f"Error reading DOCX file: {str(e)}")
        raise Exception(f"Không thể đọc file DOCX. Lỗi: {str(e)}")

def read_any_file(file_obj):
    """Read text from any supported file format"""
    file_name = getattr(file_obj, 'name', '').lower()
    
    try:
        if file_name.endswith('.pdf'):
            return read_pdf_file(file_obj)
        elif file_name.endswith('.docx'):
            return read_docx_file(file_obj)
        else:  # Assume text file
            return read_text_file(file_obj)
    except Exception as e:
        logger.error(f"Error reading file {file_name}: {str(e)}")
        raise

def get_download_link(text, filename, link_text):
    """
    Create a download link for text content
    """
    b64 = base64.b64encode(text.encode()).decode()
    href = f'<a href="data:file/txt;base64,{b64}" download="{filename}" class="download-button">{link_text}</a>'
    return href
