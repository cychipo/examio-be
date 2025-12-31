import streamlit as st
import tempfile
import os
import sys
from typing import Optional, Tuple

# Add the parent directory to sys.path to import our modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rag.retriever import process_uploaded_file, extract_text_from_file
from rag.rag_graph import KMAChatAgent, process_file_query
from rag.simple_chat_agent import SimpleChatAgent
from agent.supervisor_agent import ReActGraph


class FileUploadHandler:
    """Handler for file upload and processing functionality"""
    
    def __init__(self):
        self.uploaded_file_retriever = None
        self.file_chat_agent = None
        self.uploaded_file_name = None
        
    # def display_file_upload_interface(self):
    #     """Display the file upload interface in Streamlit"""
    #     st.subheader("📁 Upload File để Chat")
    #     st.markdown("Upload file .txt, .pdf, hoặc .docx để chat với nội dung file")
        
    #     # File uploader
    #     uploaded_file = st.file_uploader(
    #         "Chọn file để upload",
    #         type=['txt', 'pdf', 'docx'],
    #         help="Hỗ trợ file .txt, .pdf và .docx"
    #     )
        
    #     if uploaded_file is not None:
    #         return self.process_file_upload(uploaded_file)
        
    #     return False, "Chưa có file nào được upload"
    
    def process_file_upload(self, uploaded_file) -> Tuple[bool, str]:
        """Process the uploaded file and create in-memory retriever"""
        try:
            with st.spinner(f"Đang xử lý file {uploaded_file.name}..."):
                # Process the uploaded file
                retriever, message = process_uploaded_file(uploaded_file)
                
                if retriever is None:
                    st.error(f"Lỗi xử lý file: {message}")
                    return False, message
                
                # Store the retriever and file info
                self.uploaded_file_retriever = retriever
                self.uploaded_file_name = uploaded_file.name
                
                # Create a new chat agent with the file retriever - use SimpleChatAgent to avoid recursion
                self.file_chat_agent = SimpleChatAgent(custom_retriever=retriever)
                
                # Store in session state
                st.session_state.file_retriever = retriever
                st.session_state.file_chat_agent = self.file_chat_agent
                st.session_state.uploaded_file_name = uploaded_file.name
                
                st.success(message)
                st.info(f"✅ Sẵn sàng chat với file: **{uploaded_file.name}**")
                
                return True, message
                
        except Exception as e:
            error_msg = f"Lỗi xử lý file: {str(e)}"
            st.error(error_msg)
            return False, error_msg
    
    def chat_with_file(self, query: str) -> str:
        """Chat with the uploaded file content with detailed responses"""
        try:
            if self.file_chat_agent is None:
                return "❌ Chưa có file nào được upload. Vui lòng upload file trước khi chat."
            
            # Add file context to the query for better responses
            file_context_query = f"""Dựa trên nội dung file "{self.uploaded_file_name}" đã được upload, hãy trả lời câu hỏi sau một cách chi tiết:

{query}"""
            
            # Use the file chat agent to process the query
            response = self.file_chat_agent.chat(file_context_query)
            
            # Enhance response with file information
            enhanced_response = f"**📄 Trả lời dựa trên file: {self.uploaded_file_name}**\n\n{response}"
            
            return enhanced_response
            
        except Exception as e:
            return f"❌ Lỗi khi xử lý câu hỏi với file {self.uploaded_file_name}: {str(e)}\n\nVui lòng thử lại hoặc upload lại file."
    
    def get_file_info(self) -> Optional[str]:
        """Get information about the currently uploaded file"""
        if self.uploaded_file_name:
            return f"📄 File hiện tại: **{self.uploaded_file_name}**"
        return None
    
    def clear_file(self):
        """Clear the uploaded file and reset the handler"""
        self.uploaded_file_retriever = None
        self.file_chat_agent = None
        self.uploaded_file_name = None
        
        # Clear from session state
        if 'file_retriever' in st.session_state:
            del st.session_state.file_retriever
        if 'file_chat_agent' in st.session_state:
            del st.session_state.file_chat_agent
        if 'uploaded_file_name' in st.session_state:
            del st.session_state.uploaded_file_name


def display_file_upload_sidebar():
    """Display file upload section in sidebar only"""
    
    # Initialize file handler
    if 'file_handler' not in st.session_state:
        st.session_state.file_handler = FileUploadHandler()
    
    file_handler = st.session_state.file_handler
    
    # File upload section
    st.markdown("### 📁 Upload File")
    
    # File uploader
    uploaded_file = st.file_uploader(
        "Chọn file để chat",
        type=['txt', 'pdf', 'docx'],
        help="Hỗ trợ file .txt, .pdf và .docx",
        key="sidebar_file_uploader"
    )
    
    if uploaded_file is not None:
        if uploaded_file.name != st.session_state.get('last_uploaded_file_name', ''):
            with st.spinner(f"Đang xử lý file {uploaded_file.name}..."):
                # Process the uploaded file
                retriever, message = process_uploaded_file(uploaded_file)
                
                if retriever is not None:
                    # Store the retriever and file info
                    file_handler.uploaded_file_retriever = retriever
                    file_handler.uploaded_file_name = uploaded_file.name
                    
                    # Create a new chat agent with the file retriever
                    file_handler.file_chat_agent = SimpleChatAgent(custom_retriever=retriever)
                    
                    # Store in session state
                    st.session_state.file_retriever = retriever
                    st.session_state.file_chat_agent = file_handler.file_chat_agent
                    st.session_state.uploaded_file_name = uploaded_file.name
                    st.session_state.last_uploaded_file_name = uploaded_file.name
                    
                    st.success(f"✅ File {uploaded_file.name} đã được xử lý thành công!")
                else:
                    st.error(f"❌ Lỗi xử lý file: {message}")
    
    # Display current file info if available
    if hasattr(st.session_state, 'uploaded_file_name') and st.session_state.uploaded_file_name:
        st.info(f"📄 File hiện tại: **{st.session_state.uploaded_file_name}**")
        
        # Add clear file button
        if st.button("🗑️ Xóa file", type="secondary", key="clear_file_sidebar"):
            # Clear file from session
            for key in ['file_retriever', 'file_chat_agent', 'uploaded_file_name', 'last_uploaded_file_name']:
                if key in st.session_state:
                    del st.session_state[key]
            
            # Clear file handler
            if 'file_handler' in st.session_state:
                st.session_state.file_handler.clear_file()
            
            st.rerun()


def display_file_upload_in_main_interface():
    """Display file upload integration in main chat interface"""
    
    # File upload section in main interface
    with st.expander("📁 Upload File để Chat", expanded=False):
        col1, col2 = st.columns([3, 1])
        
        with col1:
            uploaded_file = st.file_uploader(
                "Chọn file để upload",
                type=['txt', 'pdf', 'docx'],
                help="Upload file .txt, .pdf hoặc .docx để chat với nội dung file",
                key="main_file_uploader"
            )
        
        with col2:
            # Clear file button
            if hasattr(st.session_state, 'uploaded_file_name') and st.session_state.uploaded_file_name:
                if st.button("🗑️ Xóa file", key="clear_file_main", type="secondary"):
                    # Clear file from session
                    for key in ['file_retriever', 'file_chat_agent', 'uploaded_file_name', 'last_uploaded_file_name']:
                        if key in st.session_state:
                            del st.session_state[key]
                    st.rerun()
        
        # Process uploaded file
        if uploaded_file is not None:
            if uploaded_file.name != st.session_state.get('last_uploaded_file_name', ''):
                with st.spinner(f"Đang xử lý file {uploaded_file.name}..."):
                    # Process the uploaded file
                    retriever, message = process_uploaded_file(uploaded_file)
                    
                    if retriever is not None:
                        # Create a new chat agent with the file retriever
                        file_chat_agent = SimpleChatAgent(custom_retriever=retriever)
                        
                        # Store in session state
                        st.session_state.file_retriever = retriever
                        st.session_state.file_chat_agent = file_chat_agent
                        st.session_state.uploaded_file_name = uploaded_file.name
                        st.session_state.last_uploaded_file_name = uploaded_file.name
                        
                        # Display detailed success message
                        st.success(f"✅ File {uploaded_file.name} đã được xử lý thành công!")
                        
                        # Show file statistics
                        file_size = len(uploaded_file.getvalue())
                        file_size_mb = file_size / (1024 * 1024)
                        
                        # Get number of chunks created
                        try:
                            docs = retriever.get_relevant_documents("test")
                            st.info(f"""� **Thông tin file:**
• **Tên file:** {uploaded_file.name}
• **Kích thước:** {file_size_mb:.2f} MB
• **Loại:** {uploaded_file.type}
• **Trạng thái:** Đã được chia thành các đoạn để xử lý AI
• **Sẵn sàng chat:** ✅ Có thể đặt câu hỏi về nội dung file""")
                        except:
                            st.info(f"""📊 **Thông tin file:**
• **Tên file:** {uploaded_file.name}
• **Kích thước:** {file_size_mb:.2f} MB
• **Loại:** {uploaded_file.type}
• **Sẵn sàng chat:** ✅ Có thể đặt câu hỏi về nội dung file""")
                        
                        st.info("💡 **Gợi ý:** Chuyển sang chế độ '📄 File đã upload' trong sidebar để chat với file này.")
                    else:
                        st.error(f"❌ Lỗi xử lý file: {message}")
        
        # Display current file info if available
        if hasattr(st.session_state, 'uploaded_file_name') and st.session_state.uploaded_file_name:
            st.success(f"📄 **File đã upload:** {st.session_state.uploaded_file_name}")
            
            # Add helpful tips
            with st.expander("💡 Mẹo sử dụng", expanded=False):
                st.markdown("""
**Để chat hiệu quả với file đã upload:**

🎯 **Đặt câu hỏi cụ thể:**
• "Tóm tắt nội dung chính của tài liệu"
• "Liệt kê các điểm quan trọng"
• "Giải thích về [chủ đề cụ thể] trong file"

🔍 **Tìm kiếm thông tin:**
• "Tài liệu có đề cập gì về [từ khóa]?"
• "Phần nào nói về [chủ đề]?"
• "Có bao nhiêu [điều gì đó] được đề cập?"

📋 **Phân tích nội dung:**
• "So sánh các ý kiến trong tài liệu"
• "Những ưu/nhược điểm được đề cập?"
• "Kết luận chính của tài liệu là gì?"
                """)
            
            # Quick action buttons
            col1, col2, col3 = st.columns(3)
            with col1:
                if st.button("📝 Tóm tắt file", key="summarize_file"):
                    st.session_state.suggested_query = "Hãy tóm tắt nội dung chính của file này một cách chi tiết"
            with col2:
                if st.button("📋 Liệt kê điểm chính", key="list_main_points"):
                    st.session_state.suggested_query = "Hãy liệt kê và giải thích các điểm chính trong tài liệu"
            with col3:
                if st.button("🔍 Phân tích nội dung", key="analyze_content"):
                    st.session_state.suggested_query = "Hãy phân tích chi tiết nội dung và cấu trúc của tài liệu này"


def get_chat_mode_selection():
    """Get chat mode selection for main interface"""
    # Check if we have file agent
    has_file_agent = 'file_chat_agent' in st.session_state
    
    if has_file_agent:
        # Show file info
        st.markdown("### 🎯 Chế độ Chat")
        st.info(f"📄 Đang chat với file: **{st.session_state.get('uploaded_file_name', 'Unknown')}**")
        return "📄 File đã upload"
    else:
        # No file agent available
        return None


# Example usage function for integration
def integrate_file_upload_to_main_chat():
    """Example function showing how to integrate file upload with main chat"""
    
    # Check if we have file agent
    has_file_agent = 'file_chat_agent' in st.session_state
    
    if has_file_agent:
        # Show file mode info
        st.sidebar.markdown("---")
        st.sidebar.subheader("🎯 Chế độ Chat")
        st.sidebar.info(f"📄 Đang chat với file: **{st.session_state.get('uploaded_file_name', 'Unknown')}**")
        return "📄 File đã upload"
    
    return None
