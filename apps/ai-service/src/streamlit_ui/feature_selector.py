import streamlit as st
import os
import sys
import re  # Thêm import cho regular expression
from pathlib import Path
import base64
import datetime
import logging

# Configure logging
logging.basicConfig(level=logging.INFO, 
                   format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Add the parent directory to sys.path to import modules
parent_dir = Path(__file__).parent.parent
sys.path.append(str(parent_dir))

# Import file utilities
try:
    from streamlit_ui.file_utils import read_any_file, get_download_link
    FILE_UTILS_AVAILABLE = True
except ImportError as e:
    logger.warning(f"File utilities not available: {e}")
    FILE_UTILS_AVAILABLE = False
    
    # Fallback function
    def get_download_link(text, filename, link_text):
        """Fallback download link generator"""
        b64 = base64.b64encode(text.encode()).decode()
        href = f'<a href="data:file/txt;base64,{b64}" download="{filename}">{link_text}</a>'
        return href

# Try to import the text summarizer
try:
    from rag.text_summarizer import summarize_text
    TEXT_SUMMARIZER_AVAILABLE = True
except ImportError as e:
    TEXT_SUMMARIZER_AVAILABLE = False
    # Fallback summarization function
    def summarize_text(text, language="vi"):
        """Simple fallback summarization when the actual module is unavailable"""
        if len(text) > 100:
            return text[:int(len(text) * 0.2)] + "..."
        return text

# Hỗ trợ đa ngôn ngữ
TRANSLATIONS = {
    "vi": {
        "feature_selection": "Lựa chọn chức năng",
        "chatbot": "Trò chuyện với KMA Agent",
        "text_summarization": "Tóm tắt văn bản",
        "select_feature": "Vui lòng chọn chức năng bạn muốn sử dụng:",
        "chatbot_description": "Đặt câu hỏi về quy định KMA, điểm số, hoặc thông tin học tập",
        "summarization_description": "Tải lên hoặc nhập văn bản để nhận bản tóm tắt ngắn gọn",
        "back_to_selection": "Quay lại lựa chọn chức năng",
        "upload_text": "Tải lên tệp văn bản",
        "paste_text": "Hoặc dán văn bản vào đây",
        "summarize_button": "Tóm tắt văn bản",
        "summary_result": "Kết quả tóm tắt:",
        "summarizing": "Đang tóm tắt...",
        "upload_prompt": "Kéo và thả tệp văn bản hoặc nhấp để tải lên",
        "max_chars": "Tối đa 10,000 ký tự",
        "download_summary": "Tải xuống bản tóm tắt",
        "copy_summary": "Sao chép bản tóm tắt",
        "copied": "Đã sao chép vào clipboard!",
        "original_text": "Văn bản gốc",
        "characters": "ký tự",
        "summary_info": "Bản tóm tắt ({summary_chars} ký tự, {percentage}% văn bản gốc)"
    },
    "en": {
        "feature_selection": "Feature Selection",
        "chatbot": "Chat with KMA Agent",
        "text_summarization": "Text Summarization",
        "select_feature": "Please select the feature you want to use:",
        "chatbot_description": "Ask questions about KMA regulations, scores, or academic information",
        "summarization_description": "Upload or paste text to get a concise summary",
        "back_to_selection": "Back to feature selection",
        "upload_text": "Upload text file",
        "paste_text": "Or paste text here",
        "summarize_button": "Summarize Text",
        "summary_result": "Summary Result:",
        "summarizing": "Summarizing...",
        "upload_prompt": "Drag and drop a text file or click to upload",
        "max_chars": "Maximum 10,000 characters",
        "download_summary": "Download summary",
        "copy_summary": "Copy summary",
        "copied": "Copied to clipboard!",
        "original_text": "Original text",
        "characters": "characters",
        "summary_info": "Summary ({summary_chars} characters, {percentage}% of original)"
    }
}

# Helper function to get translated text
def t(key):
    """Get translated text based on current language"""
    lang = st.session_state.get("language", "vi")
    return TRANSLATIONS[lang].get(key, key)

def create_feature_card(title, description, icon, on_click_function):
    """
    Create a styled card for feature selection
    """
    card_html = f"""
    <div class="feature-card" onclick="{on_click_function}">
        <div class="feature-icon">{icon}</div>
        <div class="feature-content">
            <h3 class="feature-title">{title}</h3>
            <p class="feature-description">{description}</p>
        </div>
    </div>
    """
    return card_html

def show_feature_selection():
    """
    Hiển thị trang lựa chọn chức năng
    """
    st.markdown("""
    <style>
    .feature-container {
        display: flex;
        gap: 2rem;
        margin-top: 2rem;
        flex-wrap: wrap;
    }
    
    .feature-card {
        background: linear-gradient(135deg, #ffffff 0%, #f8f9ff 100%);
        border: 2px solid #dc2626;
        border-radius: 16px;
        padding: 1.5rem;
        box-shadow: 0 8px 30px rgba(220, 38, 38, 0.15);
        width: calc(50% - 1rem);
        min-width: 300px;
        cursor: pointer;
        transition: all 0.3s ease;
        display: flex;
        align-items: center;
        gap: 1.5rem;
    }
    
    .feature-card:hover {
        transform: translateY(-5px);
        box-shadow: 0 12px 40px rgba(220, 38, 38, 0.2);
        border-color: #b91c1c;
    }
    
    .feature-icon {
        font-size: 2.5rem;
        color: #dc2626;
        background: rgba(220, 38, 38, 0.1);
        width: 70px;
        height: 70px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
    }
    
    .feature-content {
        flex: 1;
    }
    
    .feature-title {
        font-size: 1.3rem;
        font-weight: 700;
        color: #dc2626;
        margin-bottom: 0.5rem;
    }
    
    .feature-description {
        font-size: 0.9rem;
        color: #4b5563;
        margin: 0;
    }
    
    .selection-header {
        text-align: center;
        margin-bottom: 2rem;
        color: #dc2626;
        font-size: 1.8rem;
        font-weight: 800;
    }
    
    @media (max-width: 768px) {
        .feature-card {
            width: 100%;
        }
    }
    </style>
    """, unsafe_allow_html=True)
    
    st.markdown(f"<h2 class='selection-header'>{t('feature_selection')}</h2>", unsafe_allow_html=True)
    
    # Sử dụng cách tiếp cận đơn giản hơn: chỉ sử dụng các nút Streamlit
    # thay vì cố gắng kết hợp giữa HTML và JavaScript
    
    # Tạo hai cột để hiển thị các tùy chọn
    col1, col2 = st.columns(2)
    
    # Thêm CSS để làm đẹp các nút
    st.markdown("""
    <style>
    div.stButton > button {
        background: linear-gradient(135deg, #ffffff 0%, #f8f9ff 100%);
        border: 2px solid #dc2626 !important;
        border-radius: 16px !important;
        padding: 1.5rem !important;
        box-shadow: 0 8px 30px rgba(220, 38, 38, 0.15) !important;
        width: 100%;
        height: 100%;
        min-height: 180px;
        cursor: pointer;
        transition: all 0.3s ease;
        font-size: 1.3rem !important;
        font-weight: 700 !important;
        color: #dc2626 !important;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 1rem;
    }
    
    div.stButton > button:hover {
        transform: translateY(-5px);
        box-shadow: 0 12px 40px rgba(220, 38, 38, 0.2) !important;
        border-color: #b91c1c !important;
    }
    
    div.stButton > button:focus {
        outline: none !important;
        box-shadow: 0 12px 40px rgba(220, 38, 38, 0.3) !important;
    }
    
    /* Biểu tượng cho nút */
    .button-icon {
        font-size: 2.5rem;
        margin-bottom: 0.5rem;
    }
    
    /* Mô tả cho nút */
    .button-description {
        font-size: 0.85rem;
        font-weight: normal;
        color: #4b5563;
        text-align: center;
        margin-top: 0.5rem;
    }
    </style>
    """, unsafe_allow_html=True)
    
    with col1:
        # Nút cho tính năng chatbot
        chatbot_btn = st.button(
            f"💬 {t('chatbot')}\n\n" + 
            f"{t('chatbot_description')}",
            key="chatbot_btn",
            use_container_width=True
        )
        if chatbot_btn:
            st.session_state.selected_feature = "chatbot"
            st.rerun()
    
    with col2:
        # Nút cho tính năng tóm tắt văn bản
        summarize_btn = st.button(
            f"📝 {t('text_summarization')}\n\n" + 
            f"{t('summarization_description')}",
            key="summarize_btn",
            use_container_width=True
        )
        if summarize_btn:
            st.session_state.selected_feature = "summarization"
            st.rerun()

def get_download_link(text, filename, link_text):
    """
    Tạo link tải xuống cho văn bản
    """
    b64 = base64.b64encode(text.encode()).decode()
    href = f'<a href="data:file/txt;base64,{b64}" download="{filename}" class="download-button">{link_text}</a>'
    return href

def show_text_summarization():
    """
    Hiển thị chức năng tóm tắt văn bản
    """
    st.title(t('text_summarization'))
    
    if st.button(t('back_to_selection'), key="back_button"):
        st.session_state.selected_feature = None
        st.experimental_rerun()
        
    # Apply CSS for styling
    st.markdown("""
    <style>
    .summarization-container {
        background: linear-gradient(135deg, #ffffff 0%, #f8f9ff 100%);
        border: 2px solid #dc2626;
        border-radius: 16px;
        padding: 2rem;
        box-shadow: 0 8px 30px rgba(220, 38, 38, 0.15);
        margin-top: 2rem;
    }
    
    .summary-result {
        background: #f8fafc;
        border-left: 5px solid #dc2626;
        padding: 1.5rem;
        border-radius: 8px;
        margin-top: 1rem;
        margin-bottom: 1rem;
        white-space: pre-line;
    }
    
    .original-text {
        background: #f8fafc;
        border-left: 5px solid #6b7280;
        padding: 1.5rem;
        border-radius: 8px;
        margin-top: 1rem;
        margin-bottom: 1rem;
        max-height: 300px;
        overflow-y: auto;
        white-space: pre-line;
    }
    
    .action-button {
        background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
        color: white;
        border: none;
        border-radius: 8px;
        padding: 8px 16px;
        margin-right: 10px;
        cursor: pointer;
        font-weight: 600;
        transition: all 0.3s;
        display: inline-block;
    }
    
    .action-button:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(220, 38, 38, 0.2);
    }
    
    .copy-button {
        background: linear-gradient(135deg, #4b5563 0%, #374151 100%);
    }
    
    .download-button {
        display: inline-block;
        background: linear-gradient(135deg, #1e40af 0%, #1e3a8a 100%);
        color: white;
        padding: 8px 16px;
        border-radius: 8px;
        text-decoration: none;
        font-weight: 600;
        margin-right: 10px;
        transition: all 0.3s;
    }
    
    .download-button:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(30, 64, 175, 0.2);
    }
    
    .stats-container {
        display: flex;
        gap: 1rem;
        margin: 1rem 0;
        flex-wrap: wrap;
    }
    
    .stat-box {
        background: #f8fafc;
        border-radius: 8px;
        padding: 0.75rem 1rem;
        flex: 1;
        min-width: 120px;
        box-shadow: 0 2px 5px rgba(0, 0, 0, 0.05);
        text-align: center;
    }
    
    .stat-label {
        font-size: 0.8rem;
        color: #6b7280;
        margin-bottom: 0.25rem;
    }
    
    .stat-value {
        font-size: 1.1rem;
        font-weight: 600;
        color: #111827;
    }
    
    .file-info {
        background: rgba(220, 38, 38, 0.1);
        border-radius: 8px;
        padding: 0.75rem 1rem;
        margin-bottom: 1rem;
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }
    
    .file-icon {
        font-size: 1.2rem;
    }
    
    .file-name {
        font-weight: 600;
        color: #dc2626;
    }
    
    .file-size {
        color: #6b7280;
        font-size: 0.9rem;
        margin-left: auto;
    }
    </style>
    """, unsafe_allow_html=True)
    
    # Create container for the summarization tool
    summarization_container = st.container()
    
    with summarization_container:
        # File upload option
        uploaded_file = st.file_uploader(t('upload_text'), type=['txt', 'md', 'pdf', 'docx'], 
                                        help=t('upload_prompt'))
        
        # Display file info if uploaded
        if uploaded_file is not None:
            file_size = len(uploaded_file.getvalue())
            file_size_str = f"{file_size / 1024:.1f} KB" if file_size > 1024 else f"{file_size} bytes"
            
            st.markdown(f"""
            <div class="file-info">
                <span class="file-icon">📄</span>
                <span class="file-name">{uploaded_file.name}</span>
                <span class="file-size">{file_size_str}</span>
            </div>
            """, unsafe_allow_html=True)
        
        # Text input option
        text_input = st.text_area(t('paste_text'), height=200, max_chars=10000,
                                help=t('max_chars'))
        
        # Process text from either uploaded file or input
        text_to_summarize = ""
        if uploaded_file is not None:
            # Read text from the uploaded file
            try:
                if FILE_UTILS_AVAILABLE:
                    # Use the file_utils module to read the file
                    text_to_summarize = read_any_file(uploaded_file)
                else:
                    # Fallback to basic text reading
                    text_to_summarize = uploaded_file.read().decode('utf-8')
            except Exception as e:
                st.error(f"Error reading file: {str(e)}")
        elif text_input:
            text_to_summarize = text_input
        
        # Initialize summary in session_state if not exist
        if 'summary_result' not in st.session_state:
            st.session_state.summary_result = None
            st.session_state.original_text = None
        
        # Summarize button
        if st.button(t('summarize_button'), disabled=not text_to_summarize):
            with st.spinner(t('summarizing')):
                try:
                    # Lưu văn bản gốc
                    st.session_state.original_text = text_to_summarize
                    
                    # Gọi API hoặc LLM để tóm tắt
                    summary = summarize_text(text_to_summarize)
                    
                    # Lưu kết quả tóm tắt vào session state
                    st.session_state.summary_result = summary
                    
                    # Không cần rerun ở đây - sẽ tiếp tục hiển thị bên dưới
                except Exception as e:
                    st.error(f"Error: {str(e)}")
        
        # Hiển thị kết quả nếu có
        if st.session_state.summary_result:
            original_text = st.session_state.original_text
            summary_text = st.session_state.summary_result
            
            # Tính toán thống kê
            original_chars = len(original_text)
            summary_chars = len(summary_text)
            percentage = int((summary_chars / original_chars) * 100) if original_chars > 0 else 0
            
            # Hiển thị thống kê
            st.markdown(f"""
            <div class="stats-container">
                <div class="stat-box">
                    <div class="stat-label">Original</div>
                    <div class="stat-value">{original_chars} {t('characters')}</div>
                </div>
                <div class="stat-box">
                    <div class="stat-label">Summary</div>
                    <div class="stat-value">{summary_chars} {t('characters')}</div>
                </div>
                <div class="stat-box">
                    <div class="stat-label">Ratio</div>
                    <div class="stat-value">{percentage}%</div>
                </div>
            </div>
            """, unsafe_allow_html=True)
            
            # Hiển thị văn bản gốc (có thể mở rộng/thu gọn)
            with st.expander(t('original_text')):
                st.markdown(f"<div class='original-text'>{original_text}</div>", unsafe_allow_html=True)
            
            # Hiển thị kết quả tóm tắt
            st.markdown(f"<h3>{t('summary_info').format(summary_chars=summary_chars, percentage=percentage)}</h3>", 
                      unsafe_allow_html=True)
            st.markdown(f"<div class='summary-result'>{summary_text}</div>", unsafe_allow_html=True)
            
            # Buttons for actions
            col1, col2, col3 = st.columns([1, 1, 2])
            
            with col1:
                # Tạo tên file tải xuống
                now = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
                filename = f"summary_{now}.txt"
                
                # Tạo link tải xuống
                download_link = get_download_link(summary_text, filename, t('download_summary'))
                st.markdown(download_link, unsafe_allow_html=True)
            
            with col2:
                # Copy button
                if st.button(t('copy_summary')):
                    st.session_state.clipboard_text = summary_text
                    st.success(t('copied'))

def summarize_text(text):
    """
    Tóm tắt văn bản sử dụng LLM (hoặc phương pháp fallback)
    Trong thực tế, hàm này sẽ gọi API hoặc mô hình LLM để tóm tắt văn bản
    """
    try:
        # Lấy ngôn ngữ hiện tại từ session state
        language = st.session_state.get("language", "vi")
        
        if TEXT_SUMMARIZER_AVAILABLE:
            from rag.text_summarizer import summarize_text as llm_summarize
            return llm_summarize(text, language=language)
        else:
            # Fallback method without LLM - tóm tắt dài hơn (40% thay vì 20%)
            if len(text) > 100:
                # Phân đoạn text thành các câu
                if language == "vi":
                    # Các dấu hiệu kết thúc câu phổ biến trong tiếng Việt
                    sentences = re.split(r'(?<=[.!?;])\s+', text)
                    
                    # Chọn số câu để tóm tắt (khoảng 40% số câu)
                    num_sentences = max(3, int(len(sentences) * 0.4))
                    
                    # Lấy các câu quan trọng (đầu, giữa, cuối)
                    important_sentences = []
                    important_sentences.extend(sentences[:max(2, num_sentences // 3)])  # Câu đầu
                    
                    mid_start = len(sentences) // 3
                    mid_sentences = sentences[mid_start:mid_start + max(1, num_sentences // 3)]
                    important_sentences.extend(mid_sentences)  # Câu giữa
                    
                    important_sentences.extend(sentences[-max(2, num_sentences // 3):])  # Câu cuối
                    
                    summary = " ".join(important_sentences)
                    return f"(Tóm tắt tự động - không có LLM) {summary}"
                else:
                    # English
                    sentences = re.split(r'(?<=[.!?])\s+', text)
                    num_sentences = max(3, int(len(sentences) * 0.4))
                    
                    important_sentences = []
                    important_sentences.extend(sentences[:max(2, num_sentences // 3)])
                    
                    mid_start = len(sentences) // 3
                    mid_sentences = sentences[mid_start:mid_start + max(1, num_sentences // 3)]
                    important_sentences.extend(mid_sentences)
                    
                    important_sentences.extend(sentences[-max(2, num_sentences // 3):])
                    
                    summary = " ".join(important_sentences)
                    return f"(Automatic summary - no LLM available) {summary}"
            return text
    except Exception as e:
        st.error(f"Error in summarization: {str(e)}")
        # Return a safe fallback with longer summary (40% of text)
        return text[:int(len(text) * 0.4)] + "..."

def initialize_feature_selector():
    """
    Khởi tạo trạng thái cho bộ chọn tính năng
    """
    if 'selected_feature' not in st.session_state:
        st.session_state.selected_feature = None

def render_feature_ui():
    """
    Hiển thị giao diện dựa trên tính năng được chọn
    """
    initialize_feature_selector()
    
    # Hiển thị UI dựa trên tính năng được chọn
    if st.session_state.selected_feature is None:
        show_feature_selection()
    elif st.session_state.selected_feature == "summarization":
        show_text_summarization()
    elif st.session_state.selected_feature == "chatbot":
        # Return to indicate that the chatbot UI should be shown
        return True
    return False
