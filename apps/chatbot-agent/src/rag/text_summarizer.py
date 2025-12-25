"""
Công cụ tóm tắt văn bản sử dụng LLM
"""
import sys
import os
from pathlib import Path
import logging

# Thêm thư mục cha vào sys.path để import module LLM
parent_dir = Path(__file__).parent.parent
sys.path.append(str(parent_dir))

# Định cấu hình logging
logging.basicConfig(level=logging.INFO, 
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

try:
    from llm.config import get_llm  # Sử dụng get_llm() để respect runtime model selection
    LLM_AVAILABLE = True
except ImportError as e:
    logger.error(f"Error importing LLM modules: {str(e)}")
    LLM_AVAILABLE = False

# Prompt mẫu cho tóm tắt văn bản
SUMMARIZATION_PROMPT_TEMPLATE = """
Bạn là một công cụ tóm tắt văn bản thông minh. 
Nhiệm vụ của bạn là tóm tắt văn bản sau đây một cách chi tiết nhưng vẫn giữ được súc tích, 
giữ lại các thông tin quan trọng và ý chính của văn bản.

Văn bản cần tóm tắt:
---
{text}
---

Hãy tóm tắt văn bản trên theo những hướng dẫn sau:
1. Tóm tắt nên có độ dài khoảng 40-50% độ dài của văn bản gốc
2. Giữ lại tất cả các ý chính và thông tin quan trọng
3. Đảm bảo tính mạch lạc và dễ hiểu
4. Giữ lại các thông tin định lượng quan trọng (nếu có)
5. Sử dụng ngôn ngữ trung lập, khách quan

Bản tóm tắt:
"""

SUMMARIZATION_PROMPT_TEMPLATE_EN = """
You are an intelligent text summarization tool.
Your task is to summarize the following text with sufficient detail while keeping it concise,
retaining the important information and main points of the text.

Text to summarize:
---
{text}
---

Please summarize the above text according to the following guidelines:
1. The summary should be substantial, about 40-50% of the original text length
2. Retain all main ideas and important information
3. Ensure coherence and clarity
4. Retain all important quantitative information
5. Use neutral, objective language

Summary:
"""

class TextSummarizer:
    """
    Lớp tóm tắt văn bản sử dụng mô hình LLM
    """
    def __init__(self, language="vi"):
        """
        Khởi tạo đối tượng tóm tắt văn bản
        
        Args:
            language (str): Ngôn ngữ của văn bản ("vi" hoặc "en")
        """
        self.language = language
        self.llm = None
        
        if LLM_AVAILABLE:
            try:
                # Sử dụng get_llm() để respect runtime model selection
                logger.info(f"Using runtime model selection...")
                self.llm = get_llm()
                logger.info(f"Initialized LLM for text summarization")
            except Exception as e:
                logger.error(f"Failed to initialize LLM: {str(e)}")
                self.llm = None
        else:
            logger.warning("LLM modules not available. Using fallback summarization.")
    
    def summarize(self, text):
        """
        Tóm tắt văn bản sử dụng LLM
        
        Args:
            text (str): Văn bản cần tóm tắt
            
        Returns:
            str: Văn bản đã được tóm tắt
        """
        if not text:
            return "Không có văn bản để tóm tắt."
        
        # Chọn prompt theo ngôn ngữ
        prompt_template = SUMMARIZATION_PROMPT_TEMPLATE if self.language == "vi" else SUMMARIZATION_PROMPT_TEMPLATE_EN
        prompt = prompt_template.format(text=text)
        
        if self.llm:
            try:
                # Sử dụng Gemini để tóm tắt
                logger.info("Using Gemini for summarization")
                
                # Gọi phương thức invoke của Gemini
                response = self.llm.invoke(prompt)
                
                # Trích xuất nội dung từ phản hồi
                if hasattr(response, 'content'):
                    summary = response.content
                else:
                    summary = str(response)
                
                logger.info("Successfully generated summary with Gemini")
                return summary
            except Exception as e:
                logger.error(f"Error during summarization with Gemini: {str(e)}")
                return self._fallback_summarize(text)
        else:
            # Sử dụng phương pháp tóm tắt dự phòng khi không có LLM
            return self._fallback_summarize(text)
    
    def _fallback_summarize(self, text):
        """
        Phương pháp tóm tắt dự phòng khi không có LLM
        
        Args:
            text (str): Văn bản cần tóm tắt
            
        Returns:
            str: Văn bản đã được tóm tắt theo phương pháp đơn giản
        """
        # Chia văn bản thành các câu
        import re
        sentences = re.split(r'(?<=[.!?])\s+', text)
        
        # Phương pháp tóm tắt cải thiện - chọn câu đầu, giữa và cuối
        num_sentences = max(3, int(len(sentences) * 0.4))  # Tăng lên 40% số câu
        
        important_sentences = []
        # Lấy các câu đầu tiên
        important_sentences.extend(sentences[:max(2, num_sentences // 3)])
        
        # Lấy một số câu ở giữa
        mid_start = len(sentences) // 3
        mid_sentences = sentences[mid_start:mid_start + max(1, num_sentences // 3)]
        important_sentences.extend(mid_sentences)
        
        # Lấy các câu cuối
        important_sentences.extend(sentences[-max(2, num_sentences // 3):])
        
        summary = ' '.join(important_sentences)
        
        if self.language == "vi":
            return f"(Tóm tắt tự động - không có LLM) {summary}"
        else:
            return f"(Automatic summary - no LLM available) {summary}"


# Hàm tiện ích để sử dụng trực tiếp
def summarize_text(text, language="vi"):
    """
    Tóm tắt văn bản (hàm tiện ích)
    
    Args:
        text (str): Văn bản cần tóm tắt
        language (str): Ngôn ngữ của văn bản ("vi" hoặc "en")
        
    Returns:
        str: Văn bản đã được tóm tắt
    """
    summarizer = TextSummarizer(language=language)
    return summarizer.summarize(text)


# Sử dụng như một module độc lập
if __name__ == "__main__":
    # Ví dụ văn bản để kiểm tra
    test_text = """
    Học viện Kỹ thuật Mật mã (KMA) là một cơ sở giáo dục đại học công lập trực thuộc Ban Cơ yếu Chính phủ. 
    Học viện được thành lập ngày 19/03/1996 theo Quyết định số 141/TTg của Thủ tướng Chính phủ trên cơ sở Trường nghiệp vụ Cơ yếu. 
    Hiện nay, Học viện đào tạo đa ngành, đa lĩnh vực ở các trình độ cao đẳng, đại học, thạc sĩ, tiến sĩ và các chứng chỉ ngắn hạn. 
    Học viện hiện có hơn 8000 sinh viên đang theo học tại nhiều chuyên ngành khác nhau như An toàn thông tin, Công nghệ thông tin, 
    Điện tử viễn thông và các ngành khác.
    """
    
    print("Test text summarization:")
    summary = summarize_text(test_text)
    print(summary)
