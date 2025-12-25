# import asyncio
# import os
# import sys

# import streamlit as st
# from langchain_core.messages import AIMessage

# # Add the parent directory to sys.path to import our agent
# sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# # Import the agent
# from agent.supervisor_agent import ReActGraph

# st.set_page_config(page_title="KMA Agent Demo", page_icon="🤖", layout="wide", )

# # Initialize session state
# if 'messages' not in st.session_state:
#     st.session_state.messages = []

# # Add debug toggle to session state
# if 'debug_mode' not in st.session_state:
#     st.session_state.debug_mode = False

# # App title and description
# st.title("KMA Agent Demo")

# st.markdown("""
# This is a demo of the KMA Agent, a langgraph-based agent that can help students with their questions about KMA regulations, their information, and their scores.
# """)

# # Chat interface
# st.divider()
# st.subheader("Chat with the KMA Agent")

# # Display chat messages
# for message in st.session_state.messages:
#     with st.chat_message(message["role"]):
#         st.write(message["content"])

# # Initialize chat rag in session state if it doesn't exist
# if "chat_agent" not in st.session_state:
#     with st.spinner("Đang khởi tạo trợ lý ảo..."):
#         # Initialize chat rag
#         st.session_state.chat_agent = ReActGraph()
#         st.session_state.chat_agent.create_graph()
#         st.session_state.chat_agent.print_mermaid()
#         st.success("Trợ lý ảo đã sẵn sàng!")

# # Get user input
# user_query = st.chat_input("Type your question here...")

# # Process user input
# if user_query:
#     # Add user message to chat history
#     st.session_state.messages.append({"role": "user", "content": user_query})

#     # Display user message
#     with st.chat_message("user"):
#         st.write(user_query)

#     # Show thinking spinner
#     with st.chat_message("assistant"):
#         with st.spinner("Thinking..."):
#             # Call the agent
#             try:
#                 # response = asyncio.run(st.session_state.chat_agent.chat(user_query))
#                 response = asyncio.run(st.session_state.chat_agent.chat(user_query))
#                 last_res = response[-1]

#                 if isinstance(last_res, AIMessage):
#                     messages = last_res.content

#                 # Check if we got a fallback response
#                 if messages == "I couldn't generate a response. Please try a different query.":
#                     st.error(
#                         "The agent couldn't generate a proper response. Please try a different query or check the agent's implementation.")

#                 # Add assistant message to chat history
#                 st.session_state.messages.append({"role": "assistant", "content": messages})
#                 st.write(messages)
#             except Exception as e:
#                 error_msg = f"Error: {str(e)}"
#                 st.error(error_msg)
#                 st.session_state.messages.append({"role": "assistant", "content": error_msg})

# # Sidebar with additional information
# with st.sidebar:
#     st.header("About this Demo")
#     st.markdown("""
#     This demo showcases a langgraph agent built for KMA students.

#     """)

#     # Add a clear chat button
#     if st.button("Clear Chat"):
#         st.session_state.messages = []
#         st.rerun()

#     # Add a debug mode toggle
#     st.divider()
#     st.subheader("Debug Options")
#     debug_mode = st.checkbox("Enable Debug Mode", value=st.session_state.debug_mode)
#     if debug_mode != st.session_state.debug_mode:
#         st.session_state.debug_mode = debug_mode
#         st.rerun()

import asyncio
import os
import sys
import json
import hashlib
import secrets
import base64
from pathlib import Path
from datetime import datetime

import streamlit as st
from langchain_core.messages import AIMessage, HumanMessage

# Function to convert image to base64 string
def get_base64_from_image(image_path):
    """Convert an image to base64 string for embedding in HTML"""
    img_path = Path(__file__).parent / image_path
    with open(img_path, "rb") as img_file:
        return base64.b64encode(img_file.read()).decode('utf-8')

# Multi-language support dictionary
TRANSLATIONS = {
    "vi": {
        # General
        "app_title": "Học Viện Kỹ Thuật Mật Mã",
        "app_subtitle": "KMA Agent - Trợ lý ảo thông minh",
        "language_selector": "🌐 Ngôn ngữ:",
        "login": "Đăng nhập",
        "register": "Đăng ký",
        "logout": "Đăng xuất",
        "settings": "Cài đặt",
        "account_info": "Thông tin tài khoản",
        "active": "Đang hoạt động",
        
        # Chat
        "chat_with": "Chat với KMA Agent",
        "type_question": "Nhập câu hỏi của bạn...",
        "thinking": "🤔 Đang suy nghĩ...",
        "new_conversation": "➕ Tạo cuộc trò chuyện mới",
        "creating_conversation": "Đang tạo cuộc trò chuyện...",
        "conversation_list": "📋 Danh sách cuộc trò chuyện:",
        "current_conversation": "📌 Hiện tại:",
        "loading_conversation": "Đang tải cuộc trò chuyện...",
        "conversation_loaded": "✅ Đã tải cuộc trò chuyện:",
        "no_conversations": "🔍 Chưa có cuộc trò chuyện nào. Hãy bắt đầu cuộc trò chuyện mới.",
        "initializing_agent": "🔄 Đang khởi tạo trợ lý ảo...",
        "agent_ready": "✅ Trợ lý ảo đã sẵn sàng!",
        "error_initializing": "❌ Lỗi khởi tạo agent:",
        "features_unavailable": "💡 Một số tính năng có thể không khả dụng.",
        "loading_history": "🔄 Đang tải lịch sử trò chuyện...",
        
        # Login/Register
        "username": "👤 Tên đăng nhập",
        "password": "🔒 Mật khẩu",
        "confirm_password": "🔐 Xác nhận mật khẩu",
        "login_button": "🚀 Đăng nhập",
        "register_button": "🚀 Tạo tài khoản",
        "email": "📧 Email",
        "enter_username": "Nhập tên đăng nhập",
        "enter_password": "Nhập mật khẩu",
        "enter_email": "email@example.com (tùy chọn)",
        "authenticating": "🔄 Đang xác thực tài khoản...",
        "welcome_back": "🎉 Chào mừng bạn trở lại,",
        "login_error": "❌ Tên đăng nhập hoặc mật khẩu không chính xác.",
        "back_to_features": "↩️ Quay lại lựa chọn tính năng",
        "feature_selection": "Lựa chọn tính năng"
    },
    "en": {
        # General
        "app_title": "Academy of Cryptography Techniques",
        "app_subtitle": "KMA Agent - Intelligent Virtual Assistant",
        "language_selector": "🌐 Language:",
        "login": "Login",
        "register": "Register",
        "logout": "Logout",
        "settings": "Settings",
        "account_info": "Account Information",
        "active": "Active",
        
        # Chat
        "chat_with": "Chat with KMA Agent",
        "type_question": "Type your question here...",
        "thinking": "🤔 Thinking...",
        "new_conversation": "➕ Create New Conversation",
        "creating_conversation": "Creating conversation...",
        "conversation_list": "📋 Conversation List:",
        "current_conversation": "📌 Current:",
        "loading_conversation": "Loading conversation...",
        "conversation_loaded": "✅ Conversation loaded:",
        "no_conversations": "🔍 No conversations yet. Start a new conversation.",
        "initializing_agent": "🔄 Initializing virtual assistant...",
        "agent_ready": "✅ Virtual assistant is ready!",
        "error_initializing": "❌ Error initializing agent:",
        "features_unavailable": "💡 Some features may not be available.",
        "loading_history": "🔄 Loading conversation history...",
        
        # Login/Register
        "username": "👤 Username",
        "password": "🔒 Password",
        "confirm_password": "🔐 Confirm Password",
        "login_button": "🚀 Login",
        "register_button": "🚀 Create Account",
        "email": "📧 Email",
        "enter_username": "Enter username",
        "enter_password": "Enter password",
        "enter_email": "email@example.com (optional)",
        "authenticating": "🔄 Authenticating...",
        "welcome_back": "🎉 Welcome back,",
        "login_error": "❌ Incorrect username or password.",
        "login_tab": "🔐 Login",
        "register_tab": "📝 Register",
        "login_title": "🔐 LOGIN",
        "register_title": "📝 REGISTER ACCOUNT",
        "create_unique_username": "Choose a unique username",
        "min_6_chars": "Minimum 6 characters",
        "reenter_password": "Re-enter password",
        "password_strength": "🔒 Password strength:",
        "weak": "Weak",
        "medium": "Medium",
        "strong": "Strong",
        "creating_account": "🔄 Creating new account...",
        "required_fields": "⚠️ Please enter username and password.",
        "terms_required": "⚠️ Please agree to the terms and conditions.",
        "passwords_dont_match": "❌ Confirmation password doesn't match.",
        "min_password_length": "❌ Password must be at least 6 characters.",
        "username_exists": "⚠️ Username already exists. Please choose another.",
        "registration_success": "🎉 Registration successful! Welcome to KMA Assistant!",
        "registration_failed": "❌ Registration failed. Please try again later.",
        "now_login": "💡 Now you can switch to the **Login** tab to access the system.",
        "back_to_features": "↩️ Back to feature selection",
        "feature_selection": "Feature Selection"
    }
}

# Helper function to get translated text
def t(key):
    """Get translated text based on current language"""
    lang = st.session_state.get("language", "vi")
    return TRANSLATIONS.get(lang, {}).get(key, TRANSLATIONS["vi"].get(key, key))

# Import custom components
from appbar import create_appbar, create_simple_appbar, create_compact_appbar
# Import feature selector
try:
    from feature_selector import render_feature_ui
except ImportError:
    # Fallback if feature_selector is not available
    def render_feature_ui():
        pass

# Import file upload handler
try:
    from file_upload_handler import display_file_upload_sidebar, display_file_upload_in_main_interface, get_chat_mode_selection
    FILE_UPLOAD_AVAILABLE = True
except ImportError:
    FILE_UPLOAD_AVAILABLE = False
    def display_file_upload_sidebar():
        st.error("File upload functionality not available")
    def display_file_upload_in_main_interface():
        st.error("File upload functionality not available")
    def get_chat_mode_selection():
        """Simplified chat mode selection - only file mode"""
        if 'file_chat_agent' in st.session_state:
            return "� File đã upload"
        return None

# Add the parent directory to sys.path to import our agent
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Import the agent for KMA mode (when no file is uploaded)
from agent.supervisor_agent import ReActGraph

# Try to import MongoDB
try:
    from backend.db.mongodb import mongodb
    from bson import ObjectId
    MONGODB_AVAILABLE = True
except ImportError as e:
    MONGODB_AVAILABLE = False
    ObjectId = None

st.set_page_config(
    page_title="Học viện Kỹ thuật Mật mã - KMA Assistant", 
    page_icon="🛡️", 
    layout="wide",
    initial_sidebar_state="expanded"  # Always keep sidebar expanded
)

# Authentication functions
def hash_password(password):
    """Hash password using SHA-256"""
    return hashlib.sha256(password.encode()).hexdigest()

def generate_salt():
    """Generate random salt for password hashing"""
    return secrets.token_hex(16)

def hash_password_with_salt(password, salt):
    """Hash password with salt for better security"""
    return hashlib.sha256((password + salt).encode()).hexdigest()

def load_users():
    """Load users from JSON file (fallback)"""
    if os.path.exists("users.json"):
        with open("users.json", "r") as f:
            return json.load(f)
    return {}

def save_users(users):
    """Save users to JSON file (fallback)"""
    with open("users.json", "w") as f:
        json.dump(users, f, indent=4)

# MongoDB authentication functions
async def init_mongodb():
    """Initialize MongoDB connection"""
    try:
        if MONGODB_AVAILABLE and mongodb.client is None:
            await mongodb.connect_to_mongodb()
        return True
    except Exception as e:
        st.error(f"MongoDB connection error: {str(e)}")
        return False

async def save_user_to_db(username: str, password: str, email: str = None):
    """Save user to MongoDB with salt-based password hashing"""
    try:
        if not await init_mongodb():
            return False
        
        # Generate salt and hash password
        salt = generate_salt()
        password_hash = hash_password_with_salt(password, salt)
        
        # Create user data
        user_data = {
            "username": username,
            "password_hash": password_hash,
            "salt": salt,
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow()
        }
        
        if email:
            user_data["email"] = email
        
        # Insert into database
        def do_insert():
            return mongodb.db.users.insert_one(user_data)
        
        result = await asyncio.get_event_loop().run_in_executor(None, do_insert)
        return result.inserted_id is not None
        
    except Exception as e:
        st.error(f"Error saving user: {str(e)}")
        return False

async def find_user_in_db(username: str):
    """Find user in MongoDB"""
    try:
        if not await init_mongodb():
            return None
        
        def do_find():
            return mongodb.db.users.find_one({"username": username})
        
        user = await asyncio.get_event_loop().run_in_executor(None, do_find)
        return user
        
    except Exception as e:
        st.error(f"Error finding user: {str(e)}")
        return None

async def verify_user_password(username: str, password: str):
    """Verify user password against database"""
    try:
        user = await find_user_in_db(username)
        if not user:
            return False
        
        # Check with salt (new method)
        if "salt" in user and user["salt"]:
            hashed_password = hash_password_with_salt(password, user["salt"])
            return user["password_hash"] == hashed_password
        
        # Fallback: simple hash (old method)
        return user.get("password_hash") == hash_password(password)
        
    except Exception as e:
        st.error(f"Authentication error: {str(e)}")
        return False

# Conversation management functions
async def get_user_conversations(username: str):
    """Get all conversations for a user from database"""
    try:
        if not await init_mongodb():
            return []
        
        # First find the user to get their ObjectId
        user = await find_user_in_db(username)
        if not user:
            return []
        
        user_id = user["_id"]
        
        def do_find():
            cursor = mongodb.db.conversations.find(
                {"user_id": user_id}
            ).sort("updated_at", -1)
            return list(cursor)
        
        conversations = await asyncio.get_event_loop().run_in_executor(None, do_find)
        
        # Convert to display format
        formatted_conversations = []
        for conv in conversations:
            formatted_conversations.append({
                "_id": str(conv["_id"]),
                "title": conv["title"],
                "created_at": conv["created_at"],
                "updated_at": conv["updated_at"]
            })
        
        return formatted_conversations
        
    except Exception as e:
        st.error(f"Error loading conversations: {str(e)}")
        return []

async def create_new_conversation(username: str, title: str = "Cuộc trò chuyện mới"):
    """Create a new conversation for user"""
    try:
        if not await init_mongodb():
            return None
        
        # Find user to get their ObjectId
        user = await find_user_in_db(username)
        if not user:
            return None
        
        user_id = user["_id"]
        now = datetime.utcnow()
        
        conversation_data = {
            "user_id": user_id,
            "title": title,
            "created_at": now,
            "updated_at": now
        }
        
        def do_insert():
            result = mongodb.db.conversations.insert_one(conversation_data)
            return result.inserted_id
        
        conversation_id = await asyncio.get_event_loop().run_in_executor(None, do_insert)
        
        return {
            "_id": str(conversation_id),
            "title": title,
            "created_at": now,
            "updated_at": now
        }
        
    except Exception as e:
        st.error(f"Error creating conversation: {str(e)}")
        return None

async def get_conversation_messages(conversation_id: str):
    """Get all messages for a conversation"""
    try:
        if not await init_mongodb():
            return []
        
        if ObjectId and ObjectId.is_valid(conversation_id):
            conv_id = ObjectId(conversation_id)
        else:
            return []
        
        def do_find():
            cursor = mongodb.db.messages.find(
                {"conversation_id": conv_id}
            ).sort("created_at", 1)
            return list(cursor)
        
        messages = await asyncio.get_event_loop().run_in_executor(None, do_find)
        
        # Convert to display format
        formatted_messages = []
        for msg in messages:
            formatted_messages.append({
                "role": "user" if msg["is_user"] else "assistant",
                "content": msg["content"],
                "created_at": msg["created_at"]
            })
        
        return formatted_messages
        
    except Exception as e:
        st.error(f"Error loading messages: {str(e)}")
        return []

async def save_message_to_conversation(conversation_id: str, content: str, is_user: bool):
    """Save a message to a conversation"""
    try:
        if not await init_mongodb():
            return False
        
        if ObjectId and ObjectId.is_valid(conversation_id):
            conv_id = ObjectId(conversation_id)
        else:
            return False
        
        now = datetime.utcnow()
        
        message_data = {
            "conversation_id": conv_id,
            "content": content,
            "is_user": is_user,
            "created_at": now
        }
        
        def do_operations():
            # Insert message
            mongodb.db.messages.insert_one(message_data)
            # Update conversation timestamp
            mongodb.db.conversations.update_one(
                {"_id": conv_id},
                {"$set": {"updated_at": now}}
            )
            return True
        
        success = await asyncio.get_event_loop().run_in_executor(None, do_operations)
        return success
        
    except Exception as e:
        st.error(f"Error saving message: {str(e)}")
        return False

def create_chatbot_appbar(username="User"):
    """Create an app bar for chatbot interface with KMA branding"""
    
    # Generate user avatar (first letter of username)
    user_initial = username[0].upper() if username else "U"
    
    # CSS for chatbot appbar
    st.markdown("""
    <style>
    .chatbot-appbar {
        background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
        padding: 1rem 2rem;
        border-radius: 0px;
        margin-bottom: 2rem;
        margin-top: -1rem;
        box-shadow: 0 4px 15px rgba(220, 38, 38, 0.3);
        display: flex;
        justify-content: space-between;
        align-items: center;
        position: relative;
        z-index: 1000;
    }
    
    .chatbot-logo-section {
        display: flex;
        align-items: center;
        gap: 1rem;
    }
    
    .chatbot-logo {
        width: 50px;
        height: 50px;
        border-radius: 50%;
        background: linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%);
        border: 3px solid #ffffff;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
        overflow: hidden;
    }
    
    .chatbot-logo img {
        width: 100%;
        height: 100%;
        object-fit: contain;
    }
    
    .chatbot-title {
        color: #ffffff;
        font-size: 1.8rem;
        font-weight: 900;
        margin: 0;
        text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
        font-family: 'Impact', 'Arial Black', sans-serif;
        letter-spacing: 1px;
        text-transform: uppercase;
    }
    
    .chatbot-subtitle {
        color: #fecaca;
        font-size: 0.9rem;
        margin: 0;
        font-weight: 600;
        letter-spacing: 0.5px;
    }
    
    .user-info-section {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        color: #ffffff;
    }
    
    .user-avatar-display {
        width: 45px;
        height: 45px;
        border-radius: 50%;
        background: linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%);
        border: 3px solid #ffffff;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.2rem;
        font-weight: 900;
        color: #dc2626;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
        transition: all 0.3s ease;
    }
    
    .user-avatar-display:hover {
        transform: scale(1.05);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }
    
    .user-details {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
    }
    
    .username-display {
        font-size: 1rem;
        font-weight: 700;
        margin: 0;
        text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.3);
    }
    
    .status-display {
        font-size: 0.8rem;
        color: #fecaca;
        margin: 0;
        font-weight: 500;
    }
    </style>
    """, unsafe_allow_html=True)
    
    # Create the appbar HTML
    st.markdown(f"""
    <div class="chatbot-appbar">
        <div class="chatbot-logo-section">
            <div class="chatbot-logo">
                <img src="data:image/png;base64,{get_base64_from_image('img/kma.png')}" alt="KMA Logo" width="45" height="45">
            </div>
            <div>
                <h1 class="chatbot-title">Học viện Kỹ thuật Mật mã</h1>
                <p class="chatbot-subtitle">KMA Assistant - Trợ lý ảo thông minh</p>
            </div>
        </div>
        
        <div class="user-info-section">
            <div class="user-details">
                <p class="username-display">👤 {username}</p>
                <p class="status-display">🟢 Đang hoạt động</p>
            </div>
            <div class="user-avatar-display">
                {user_initial}
            </div>
        </div>
    </div>
    """, unsafe_allow_html=True)

def show_login_page():
    """Display enhanced login and registration interface"""
    # Initialize language if not exists
    if 'language' not in st.session_state:
        st.session_state.language = "vi"  # Default to Vietnamese
        
    # Xử lý query parameter ngôn ngữ
    query_params = dict(st.query_params)
    if "lang" in query_params:
        lang = query_params["lang"][0]
        if lang in ["vi", "en"] and lang != st.session_state.language:
            st.session_state.language = lang
            # Xóa query parameter để tránh việc thay đổi ngôn ngữ liên tục khi refresh
            query_params.pop("lang", None)
            # Update query parameters with remaining params
            st.query_params.update(query_params)
            st.rerun()
        
    st.markdown("""
    <style>
    .main > div {
        padding-top: 0rem !important;
    }
    .block-container {
        padding-top: 0rem !important;
        margin-top: 0rem !important;
    }
    </style>
    """, unsafe_allow_html=True)

    # CSS cho language switcher ở góc dưới bên trái
    st.markdown("""
    <style>
    /* Ẩn sidebar trong trang đăng nhập */
    section[data-testid="stSidebar"] {
        display: none !important;
        visibility: hidden !important;
    }
    
    /* Floating language selector button */
    .language-float-button {
        position: fixed;
        bottom: 20px;
        left: 20px;
        width: 50px;
        height: 50px;
        border-radius: 50%;
        background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
        color: white;
        font-size: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 15px rgba(220, 38, 38, 0.4);
        cursor: pointer;
        z-index: 9999;
        transition: all 0.3s ease;
    }
    
    .language-float-button:hover {
        transform: scale(1.05);
        box-shadow: 0 6px 20px rgba(220, 38, 38, 0.5);
    }
    
    /* Language popup menu */
    .language-popup {
        position: fixed;
        bottom: 80px;
        left: 20px;
        background: white;
        border-radius: 10px;
        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
        padding: 15px;
        z-index: 9998;
        display: none;
        width: 160px;
    }
    
    .language-popup.visible {
        display: block;
        animation: fadeInUp 0.3s ease;
    }
    
    @keyframes fadeInUp {
        from {
            opacity: 0;
            transform: translateY(20px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }
    
    .language-option {
        padding: 10px;
        display: flex;
        align-items: center;
        gap: 10px;
        cursor: pointer;
        border-radius: 5px;
        transition: all 0.2s ease;
    }
    
    .language-option:hover {
        background: rgba(220, 38, 38, 0.1);
    }
    
    .language-option.active {
        background: rgba(220, 38, 38, 0.15);
        font-weight: bold;
    }
    </style>
    """, unsafe_allow_html=True)
    
    # Ẩn các radio buttons cho ngôn ngữ
    st.markdown("""
    <style>
    /* Ẩn container của nút radio ngôn ngữ */
    [data-testid="stVerticalBlock"] > div:has(div[data-testid="stRadio"]) {
        display: none !important;
        height: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        position: absolute !important;
        opacity: 0 !important;
    }
    </style>
    """, unsafe_allow_html=True)

    # Appbar (Fallback nếu cần)
    try:
        create_appbar()
    except:
        st.markdown(f"""
        <div style="background: linear-gradient(90deg, #dc2626 0%, #b91c1c 100%); padding: 1rem; border-radius: 0px; margin-top: 0; margin-bottom: 2rem; display: flex; justify-content: center; align-items: center; flex-direction: column;">
            <div style="width: 60px; height: 60px; background: white; border-radius: 50%; display: flex; justify-content: center; align-items: center; margin-bottom: 0.5rem; overflow: hidden;">
                <img src="data:image/png;base64,{get_base64_from_image('./img/kma.png')}" alt="KMA Logo" width="55" height="55" style="object-fit: contain;">
            </div>
            <h1 style="color: white; text-align: center; margin: 0;">Học viện Kỹ thuật Mật mã</h1>
            <p style="color: #fecaca; text-align: center; margin: 0.5rem 0 0 0;">KMA Assistant - Trợ lý ảo thông minh</p>
        </div>
        """, unsafe_allow_html=True)

    # Tabs với CSS đẹp hơn
    st.markdown("""
    <style>
    .stTabs [data-baseweb="tab-list"] {
        gap: 2rem;
        background: rgba(220, 38, 38, 0.05);
        padding: 0.5rem;
        border-radius: 15px;
        border: 2px solid rgba(220, 38, 38, 0.1);
    }
    .stTabs [data-baseweb="tab"] {
        height: 3rem;
        padding: 0 2rem;
        background: white;
        border-radius: 10px;
        border: 2px solid transparent;
        color: #dc2626;
        font-weight: bold;
        transition: all 0.3s ease;
    }
    .stTabs [aria-selected="true"] {
        background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
        color: white;
        border-color: #dc2626;
        box-shadow: 0 4px 12px rgba(220, 38, 38, 0.3);
    }
    .stTabs [data-baseweb="tab"]:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(220, 38, 38, 0.2);
    }
    </style>
    """, unsafe_allow_html=True)

    # Tabs đăng nhập / đăng ký
    tab1, tab2 = st.tabs([f"🔐 {t('login')}", f"📝 {t('register')}"]) 
    with tab1:
        login_form()
    with tab2:
        register_form()
    
    # Ẩn nút radio cho ngôn ngữ
    col1 = st.container()
    with col1:
        lang_options = {"vi": "🇻🇳 Tiếng Việt", "en": "🇬🇧 English"}
        current_lang = st.session_state.language
    
    # Floating language selector 
    current_lang = st.session_state.language
    
    # Thay vì dùng JavaScript, tạo hai button để thay đổi ngôn ngữ
    st.markdown(f"""
    <style>
    .language-container {{
        position: fixed;
        bottom: 20px;
        left: 20px;
        z-index: 9999;
        display: flex;
        flex-direction: column;
        gap: 10px;
        align-items: center;
    }}
    
    .lang-float-button {{
        width: 50px;
        height: 50px;
        border-radius: 50%;
        background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
        color: white;
        font-size: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 15px rgba(220, 38, 38, 0.4);
        cursor: pointer;
        transition: all 0.3s ease;
        border: none;
    }}
    
    .lang-option {{
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background: white;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
        cursor: pointer;
        font-size: 20px;
        transition: all 0.3s ease;
        opacity: 0.9;
        border: 2px solid {("#dc2626" if current_lang == "vi" else "#e5e7eb")};
    }}
    
    .lang-option.en {{
        border: 2px solid {("#dc2626" if current_lang == "en" else "#e5e7eb")};
    }}
    
    .lang-option:hover {{
        transform: scale(1.1);
    }}
    </style>
    
    <div class="language-container">
        <a href="?lang=vi" target="_self" class="lang-option vi">🇻🇳</a>
        <a href="?lang=en" target="_self" class="lang-option en">🇬🇧</a>
    </div>
    """, unsafe_allow_html=True)

    
    
def login_form():
    # CSS styles - Style the form directly, not wrap it in div
    st.markdown("""
    <style>
    /* Style the Streamlit form element directly */
    .stForm {
        background: linear-gradient(135deg, #ffffff 0%, #f8f9ff 100%) !important;
        border: 3px solid #dc2626 !important;
        border-radius: 20px !important;
        box-shadow: 0 12px 40px rgba(220, 38, 38, 0.15) !important;
        padding: 2.5rem !important;
        max-width: 600px !important;
        margin: 3rem auto !important;
    }
    
    /* Remove default form styling */
    .stForm > div {
        padding: 0 !important;
        border: none !important;
    }
    
    /* Title styling */
    .login-title {
        font-size: 2rem;
        font-weight: bold;
        text-align: center;
        color: #dc2626;
        margin-bottom: 2rem;
    }
    
    /* Input field styling */
    .stTextInput > div > div > input {
        border-radius: 10px;
        border: 2px solid #e5e7eb;
        padding: 12px;
        font-size: 16px;
    }
    .stTextInput > div > div > input:focus {
        border-color: #dc2626;
        box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.1);
    }
    
    /* Button styling */
    .stFormSubmitButton > button {
        width: 100%;
        background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
        color: white;
        border: none;
        border-radius: 10px;
        padding: 12px 24px;
        font-weight: 600;
        transition: all 0.3s ease;
        margin-top: 1rem;
    }
    .stFormSubmitButton > button:hover {
        background: linear-gradient(135deg, #b91c1c 0%, #991b1b 100%);
        transform: translateY(-2px);
        box-shadow: 0 8px 25px rgba(220, 38, 38, 0.3);
    }
    </style>
    """, unsafe_allow_html=True)

    # Create centered layout
    col1, col2, col3 = st.columns([0.2, 1.5, 0.2])
    with col2:
        # ✅ ĐÚNG: Không dùng div wrapper, style trực tiếp form
        with st.form("login_form", clear_on_submit=False):
            # Title inside form
            st.markdown(f'<div class="login-title">ĐĂNG NHẬP</div>', unsafe_allow_html=True)
            
            username = st.text_input(
                t("username"), 
                placeholder=t("enter_username"),
                key="login_username"
            )
            password = st.text_input(
                t("password"), 
                type="password", 
                placeholder=t("enter_password"),
                key="login_password"
            )
            
            submitted = st.form_submit_button(t("login_button"))

            # Handle form submission within the form context
            if submitted:
                if not username or not password:
                    st.error(t("required_fields"))
                else:
                    with st.spinner("🔄 Đang xác thực tài khoản..."):
                        try:
                            if MONGODB_AVAILABLE:
                                login_success = asyncio.run(verify_user_password(username, password))
                            else:
                                users = load_users()
                                login_success = username in users and users[username] == hash_password(password)

                            if login_success:
                                st.success(f"🎉 Chào mừng bạn trở lại, {username}!")
                                st.session_state["logged_in"] = True
                                st.session_state["username"] = username
                                
                                # Tải lịch sử trò chuyện ngay khi đăng nhập thành công
                                if MONGODB_AVAILABLE:
                                    with st.spinner("🔄 Đang tải lịch sử trò chuyện..."):
                                        conversations = asyncio.run(get_user_conversations(username))
                                        st.session_state.conversations = conversations
                                
                                st.balloons()
                                # Use st.rerun() after a short delay or in a callback
                                st.session_state["should_rerun"] = True
                            else:
                                st.error("❌ Tên đăng nhập hoặc mật khẩu không chính xác.")
                        except Exception as e:
                            st.error(f"❌ Lỗi hệ thống: {str(e)}")

    # Handle rerun outside of form context
    if st.session_state.get("should_rerun", False):
        st.session_state["should_rerun"] = False
        st.rerun()


def register_form():
    """Fixed registration form with same structure as working login form"""
    
    # CSS styles - Style the form directly, not wrap it in div
    st.markdown("""
    <style>
    /* Style the Streamlit form element directly for register */
    .stForm {
        background: linear-gradient(135deg, #ffffff 0%, #fff8f8 100%) !important;
        border: 3px solid #dc2626 !important;
        border-radius: 20px !important;
        box-shadow: 0 12px 40px rgba(220, 38, 38, 0.15) !important;
        padding: 2.5rem !important;
        max-width: 650px !important;
        margin: 3rem auto !important;
    }
    
    /* Remove default form styling */
    .stForm > div {
        padding: 0 !important;
        border: none !important;
    }
    
    /* Title styling */
    .register-title {
        font-size: 2.2rem;
        font-weight: bold;
        text-align: center;
        color: #dc2626;
        margin-bottom: 2rem;
        text-shadow: 0 2px 4px rgba(220, 38, 38, 0.1);
    }
    
    /* Input field styling */
    .stTextInput > div > div > input {
        border-radius: 12px;
        border: 2px solid #e5e7eb;
        padding: 14px 16px;
        font-size: 16px;
        background: white;
        transition: all 0.3s ease;
    }
    .stTextInput > div > div > input:focus {
        border-color: #dc2626;
        box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.1);
    }
    .stTextInput > label {
        font-size: 16px;
        font-weight: 600;
        color: #374151;
        margin-bottom: 8px;
    }
    
    /* Button styling */
    .stFormSubmitButton > button {
        width: 100%;
        background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
        color: white;
        border: none;
        border-radius: 12px;
        padding: 14px 24px;
        font-weight: 600;
        font-size: 16px;
        transition: all 0.3s ease;
        margin-top: 1rem;
    }
    .stFormSubmitButton > button:hover {
        background: linear-gradient(135deg, #b91c1c 0%, #991b1b 100%);
        transform: translateY(-2px);
        box-shadow: 0 8px 25px rgba(220, 38, 38, 0.3);
    }
    
    /* Checkbox styling */
    .stCheckbox > label {
        font-size: 15px;
        font-weight: 500;
        color: #374151;
    }
    
    /* Info box styling */
    .register-info {
        background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
        padding: 1.5rem;
        border-radius: 12px;
        border-left: 5px solid #dc2626;
        margin: 1.5rem 0;
        font-size: 15px;
    }
    
    /* Terms container */
    .terms-container {
        background: rgba(220, 38, 38, 0.05);
        padding: 1.5rem;
        border-radius: 12px;
        border: 2px solid rgba(220, 38, 38, 0.2);
        margin: 1.5rem 0;
        font-size: 15px;
    }
    
    /* Password strength indicator */
    .password-strength {
        margin: 0.75rem 0;
        padding: 0.75rem;
        border-radius: 10px;
        font-size: 14px;
        text-align: center;
        font-weight: bold;
    }
    .strength-weak {
        background-color: #fee2e2;
        color: #dc2626;
        border: 1px solid #fecaca;
    }
    .strength-medium {
        background-color: #fef3c7;
        color: #d97706;
        border: 1px solid #fed7aa;
    }
    .strength-strong {
        background-color: #dcfce7;
        color: #16a34a;
        border: 1px solid #bbf7d0;
    }
    </style>
    """, unsafe_allow_html=True)

    # Create centered layout
    col1, col2, col3 = st.columns([0.1, 1.8, 0.1])
    with col2:
        # ✅ ĐÚNG: Không dùng div wrapper, style trực tiếp form
        with st.form("register_form", clear_on_submit=False):
            # Title inside form
            st.markdown(f'<div class="register-title">ĐĂNG KÝ</div>', unsafe_allow_html=True)
            
           
            
            # Form fields
            username = st.text_input(
                t("username"), 
                placeholder=t("create_unique_username"),
                key="register_username"
            )
            
            email = st.text_input(
                t("email"), 
                placeholder=t("enter_email"),
                key="register_email"
            )
            
            # Password with strength indicator
            password = st.text_input(
                t("password"), 
                type="password", 
                placeholder=t("min_6_chars"),
                key="register_password"
            )
            
            # Password strength indicator (inside form)
            if password:
                strength = "weak"
                strength_text = t("weak")
                if len(password) >= 8 and any(c.isupper() for c in password) and any(c.isdigit() for c in password):
                    strength = "strong"
                    strength_text = t("strong")
                elif len(password) >= 6:
                    strength = "medium"
                    strength_text = t("medium")
                
                st.markdown(f"""
                <div class="password-strength strength-{strength}">
                    {t("password_strength")} {strength_text}
                </div>
                """, unsafe_allow_html=True)
            
            confirm = st.text_input(
                t("confirm_password"), 
                type="password", 
                placeholder=t("reenter_password"),
                key="register_confirm"
            )
            
          
           
            # Submit button
            submitted = st.form_submit_button(t("register_button"))
            agree_terms = st.checkbox(t("agree_terms"))
            # Handle form submission within the form context
            if submitted:
                if not username or not password:
                    st.error(t("required_fields"))
                elif password != confirm:
                    st.error(t("passwords_dont_match"))
                elif len(password) < 6:
                    st.error(t("min_password_length"))
                else:
                    with st.spinner(t("creating_account")):
                        try:
                            if MONGODB_AVAILABLE:
                                # Check if user exists in MongoDB
                                existing_user = asyncio.run(find_user_in_db(username))
                                if existing_user:
                                    st.warning(t("username_exists"))
                                else:
                                    # Save to MongoDB
                                    save_success = asyncio.run(save_user_to_db(username, password, email))
                                    if save_success:
                                        st.success(t("registration_success"))
                                        st.balloons()
                                        st.info(t("now_login"))
                                        st.session_state["should_clear_form"] = True
                                    else:
                                        st.error(t("registration_failed"))
                            else:
                                # Fallback to JSON file
                                users = load_users()
                                if username in users:
                                    st.warning(t("username_exists"))
                                else:
                                    users[username] = hash_password(password)
                                    save_users(users)
                                    st.success(t("registration_success"))
                                    st.balloons()
                                    st.info(t("now_login"))
                                    st.session_state["should_clear_form"] = True
                        except Exception as e:
                            st.error(f"❌ {str(e)}")

    # Handle form clearing outside of form context
    if st.session_state.get("should_clear_form", False):
        st.session_state["should_clear_form"] = False
        # Clear form by rerunning (optional)
        # st.rerun()




def show_chatbot_interface():
    """Display the main chatbot interface for authenticated users"""
    # Initialize language if not exists
    if 'language' not in st.session_state:
        st.session_state.language = "vi"  # Default to Vietnamese
        
    # Xử lý query parameter ngôn ngữ
    query_params = dict(st.query_params)
    if "lang" in query_params:
        lang = query_params["lang"][0]
        if lang in ["vi", "en"] and lang != st.session_state.language:
            st.session_state.language = lang
            # Xóa query parameter để tránh việc thay đổi ngôn ngữ liên tục khi refresh
            query_params.pop("lang", None)
            # Update query parameters with remaining params
            st.query_params.update(query_params)
            st.rerun()
        
    # CSS to ensure sidebar is always visible but not overlapping main content
    st.markdown("""
    <style>
    .main > div {
        padding-top: 0rem !important;
    }
    .block-container {
        padding-top: 0rem !important;
        margin-top: 0rem !important;
        padding-left: 1rem !important;
        padding-right: 1rem !important;
    }
    /* Force sidebar to be always visible */
    section[data-testid="stSidebar"] {
        display: block !important;
        visibility: visible !important;
        width: 21rem !important;
        min-width: 21rem !important;
        max-width: 21rem !important;
        flex-shrink: 0 !important;
    }
    /* Hide sidebar collapse button */
    button[kind="header"][data-testid="collapsedControl"] {
        display: none !important;
    }
    /* Ensure main content doesn't overlap with sidebar */
    .main {
        margin-left: 0 !important;
    }
    .main .block-container {
        max-width: none !important;
        padding-left: 2rem !important;
        padding-right: 2rem !important;
    }
    /* Ensure proper spacing */
    [data-testid="stSidebar"] + .main {
        padding-left: 0 !important;
    }
    
    /* Floating language selector button */
    .language-float-button {
        position: fixed;
        bottom: 20px;
        left: 20px;
        width: 50px;
        height: 50px;
        border-radius: 50%;
        background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
        color: white;
        font-size: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 15px rgba(220, 38, 38, 0.4);
        cursor: pointer;
        z-index: 9999;
        transition: all 0.3s ease;
    }
    
    .language-float-button:hover {
        transform: scale(1.05);
        box-shadow: 0 6px 20px rgba(220, 38, 38, 0.5);
    }
    
    /* Language popup menu */
    .language-popup {
        position: fixed;
        bottom: 80px;
        left: 20px;
        background: white;
        border-radius: 10px;
        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
        padding: 15px;
        z-index: 9998;
        display: none;
        width: 160px;
    }
    
    .language-popup.visible {
        display: block;
        animation: fadeInUp 0.3s ease;
    }
    
    @keyframes fadeInUp {
        from {
            opacity: 0;
            transform: translateY(20px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }
    
    .language-option {
        padding: 10px;
        display: flex;
        align-items: center;
        gap: 10px;
        cursor: pointer;
        border-radius: 5px;
        transition: all 0.2s ease;
    }
    
    .language-option:hover {
        background: rgba(220, 38, 38, 0.1);
    }
    
    .language-option.active {
        background: rgba(220, 38, 38, 0.15);
        font-weight: bold;
    }
    
    /* Chatbot appbar styles */
    .kma-chatbot-appbar {
        background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
        padding: 1rem 2rem;
        border-radius: 0px;
        margin-bottom: 1.5rem;
        margin-top: -1rem;
        box-shadow: 0 4px 15px rgba(220, 38, 38, 0.3);
        display: flex;
        justify-content: space-between;
        align-items: center;
    }
    
    .kma-logo-section {
        display: flex;
        align-items: center;
        gap: 1rem;
    }
    
    .kma-logo {
        width: 70px;
        height: 70px;
        border-radius: 50%;
        background: white;
        border: 2px solid white;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
    }
    
    .kma-logo img {
        width: 100%;
        height: 100%;
        object-fit: contain;
    }
    
    .kma-title-section {
        display: flex;
        flex-direction: column;
    }
    
    .kma-title {
        color: white !important;
        font-size: 1.5rem;
        font-weight: 800;
        margin: 0;
        line-height: 1.2;
        text-shadow: 1px 1px 2px rgba(0,0,0,0.3);
    }
    
    .kma-subtitle {
        color: rgba(255,255,255,0.8);
        font-size: 0.85rem;
        margin: 0;
        font-weight: 500;
    }
    
    .user-info-section {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        position: relative;
    }
    
    .user-avatar {
        width: 38px;
        height: 38px;
        border-radius: 50%;
        background: white;
        color: #dc2626;
        border: 2px solid white;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.1rem;
        font-weight: 700;
        box-shadow: 0 2px 5px rgba(0,0,0,0.2);
        cursor: pointer;
        transition: all 0.2s ease;
    }
    
    .user-avatar:hover {
        transform: scale(1.05);
        box-shadow: 0 4px 10px rgba(0,0,0,0.3);
    }
    
    .user-details {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
    }
    
    .username {
        color: white;
        font-size: 0.95rem;
        font-weight: 600;
        margin: 0;
    }
    
    .user-status {
        color: rgba(255,255,255,0.8);
        font-size: 0.8rem;
        margin: 0;
    }
    
    /* CSS-only dropdown menu implementation */
    .dropdown-container {
        position: relative;
        display: inline-block;
    }
    
    /* Hide the checkbox but keep it functional */
    .dropdown-toggle {
        display: none;
    }
    
    /* Style for the dropdown menu */
    .user-dropdown {
        position: absolute;
        right: 0;
        top: 50px;
        background: white;
        border-radius: 10px;
        box-shadow: 0 4px 15px rgba(0,0,0,0.2);
        width: 180px;
        z-index: 9999;
        overflow: hidden;
        opacity: 0;
        visibility: hidden;
        transform: translateY(-10px);
        transition: opacity 0.2s, transform 0.2s, visibility 0.2s;
    }
    
    /* Show dropdown when checkbox is checked */
    .dropdown-toggle:checked ~ .user-dropdown {
        opacity: 1;
        visibility: visible;
        transform: translateY(0);
    }
    
    .dropdown-item {
        padding: 12px 16px;
        display: flex;
        align-items: center;
        gap: 10px;
        color: #4b5563;
        font-size: 14px;
        cursor: pointer;
        transition: all 0.2s ease;
    }
    
    .dropdown-item:hover {
        background: #f9fafb;
    }
    
    .dropdown-item.logout {
        color: #dc2626;
        border-top: 1px solid #e5e7eb;
    }
    
    /* Hide the form submit button but keep the form functional */
    #logout_form {
        display: none;
    }
    
    /* Style the logout button in dropdown to look like a regular item */
    form#logoutForm {
        margin: 0;
        padding: 0;
        width: 100%;
    }
    
    form#logoutForm button {
        width: 100%;
        background: none;
        border: none;
        text-align: left;
        padding: 12px 16px;
        display: flex;
        align-items: center;
        gap: 10px;
        color: #dc2626;
        font-size: 14px;
        cursor: pointer;
        transition: all 0.2s ease;
        border-top: 1px solid #e5e7eb;
    }
    
    form#logoutForm button:hover {
        background: #f9fafb;
    }
    </style>
    """, unsafe_allow_html=True)
    
    # Create KMA Chatbot Appbar with CSS-only dropdown
    username = st.session_state.get("username", "User")
    user_initial = username[0].upper() if username else "U"
    
    
    
    # Apply CSS styles
    st.markdown("""
    <style>
    /* Hide the checkbox container and logout button */
    div[data-testid="element-container"]:has(#dropdown_toggle),
    div[data-testid="element-container"]:has(button#logoutButton) {
        display: none !important;
        height: 0 !important;
        width: 0 !important;
        position: absolute !important;
        padding: 0 !important;
        margin: 0 !important;
    }
    
    /* CSS-only dropdown implementation */
    .dropdown-container {
        position: relative;
        display: inline-block;
    }
    
    /* Hide the checkbox but make it accessible to the label */
    .dropdown-toggle {
        display: none;
    }
    
    /* User avatar styling (label for the checkbox) */
    .user-avatar {
        width: 38px;
        height: 38px;
        border-radius: 50%;
        background: white;
        color: #dc2626;
        border: 2px solid white;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.1rem;
        font-weight: 700;
        box-shadow: 0 2px 5px rgba(0,0,0,0.2);
        cursor: pointer;
        transition: all 0.2s ease;
    }
    
    .user-avatar:hover {
        transform: scale(1.05);
        box-shadow: 0 4px 10px rgba(0,0,0,0.3);
    }
    
    /* Style for the dropdown menu */
    .user-dropdown {
        position: absolute;
        right: 0;
        top: 45px;
        background: white;
        border-radius: 10px;
        box-shadow: 0 4px 15px rgba(0,0,0,0.2);
        width: 180px;
        z-index: 9999;
        overflow: hidden;
        opacity: 0;
        visibility: hidden;
        transform: translateY(-10px);
        transition: opacity 0.2s, transform 0.2s, visibility 0.2s;
    }
    
    /* Show dropdown when checkbox is checked */
    .dropdown-toggle:checked ~ .user-dropdown {
        opacity: 1;
        visibility: visible;
        transform: translateY(0);
    }
    
    .dropdown-item {
        padding: 12px 16px;
        display: flex;
        align-items: center;
        gap: 10px;
        color: #4b5563;
        font-size: 14px;
        cursor: pointer;
        transition: all 0.2s ease;
    }
    
    .dropdown-item:hover {
        background: #f9fafb;
    }
    
    .dropdown-item.logout {
        color: #dc2626;
        border-top: 1px solid #e5e7eb;
    }
    </style>
    """, unsafe_allow_html=True)
    
    # Create appbar with CSS-only dropdown
    st.markdown(f"""
    <div class="kma-chatbot-appbar">
        <div class="kma-logo-section">
            <div class="kma-logo"><img src="data:image/png;base64,{get_base64_from_image('img/kma.png')}" alt="KMA Logo" width="40" height="40"></div>
            <div class="kma-title-section">
                <h2 class="kma-title">{t("app_title")}</h2>
                <p class="kma-subtitle">{t("app_subtitle")}</p>
            </div>
        </div>
        <div class="user-info-section">
            <div class="user-details">
                <p class="username">👤 {username}</p>
                <p class="user-status">🟢 {t("active")}</p>
            </div>
            <div class="dropdown-container">
                <label for="dropdown_toggle" class="user-avatar">
                    {user_initial}
                </label>
                <input type="checkbox" id="dropdown_toggle" class="dropdown-toggle">
                <div class="user-dropdown">
                    <div class="dropdown-item">
                        <span>👤</span> {t("account_info")}
                    </div>
                    <div class="dropdown-item">
                        <span>⚙️</span> {t("settings")}
                    </div>
                    <div class="dropdown-item" onclick="document.getElementById('language_toggle').click()">
                        <span>🌐</span> {st.session_state.language.upper()} 
                    </div>
                    <div class="dropdown-item logout" onclick="document.getElementById('logoutButton').click()">
                        <span>🚪</span> {t("logout")}
                    </div>
                </div>
            </div>
        </div>
    </div>
    """, unsafe_allow_html=True)
    
   
    
    
    
def main():
    """Main application function with authentication"""
    # Initialize session state variables
    if "logged_in" not in st.session_state:
        st.session_state["logged_in"] = False
        st.session_state["username"] = ""
    
    # Initialize debug_mode
    if 'debug_mode' not in st.session_state:
        st.session_state.debug_mode = False
    
    # Check if user is logged in
    if not st.session_state["logged_in"]:
        # CSS for login page - remove top margin/padding for full-width appbar
        st.markdown("""
        <style>
        .main > div {
            padding-top: 0rem !important;
        }
        .block-container {
            padding-top: 0rem !important;
            margin-top: 0rem !important;
        }
        </style>
        """, unsafe_allow_html=True)
        show_login_page()
        return
    
    # If logged in, show chatbot interface (no appbar, fixed sidebar)
    show_chatbot_interface()
    
    # Initialize session state for feature selection
    if 'selected_feature' not in st.session_state:
        st.session_state.selected_feature = None
    
    # Show feature selector if no feature is selected
    if st.session_state.selected_feature is None:
        try:
            # Try to render the feature selection UI
            render_feature_ui()
            return  # Return early to avoid rendering the chatbot interface
        except Exception as e:
            # If there's an error, continue with chatbot interface
            if st.session_state.debug_mode:
                st.error(f"Error loading feature selector: {str(e)}")
            # Automatically select chatbot as default
            st.session_state.selected_feature = "chatbot"
    
    # If text summarization is selected, show that UI
    if st.session_state.selected_feature == "summarization":
        try:
            render_feature_ui()
            return
        except Exception as e:
            if st.session_state.debug_mode:
                st.error(f"Error loading summarization feature: {str(e)}")
            st.session_state.selected_feature = "chatbot"
            st.rerun()
    
    # Continue with chatbot UI (default option)
    # Initialize chatbot session state
    if 'messages' not in st.session_state:
        st.session_state.messages = []  # This will be a list of dicts for display

    if 'conversation_history' not in st.session_state:
        st.session_state.conversation_history = []  # This will be list of BaseMessages for agent

    # Note: debug_mode already initialized at the beginning of main()
        
    # Tải lịch sử trò chuyện nếu chưa được tải
    if "conversations" not in st.session_state and MONGODB_AVAILABLE:
        with st.spinner(t("loading_history")):
            conversations = asyncio.run(get_user_conversations(st.session_state.username))
            st.session_state.conversations = conversations

    # Chat interface section
    st.subheader(f"💬 {t('chat_with')}")
    st.success(t("agent_ready"))
    
    
    
   
    
    # Show current conversation info
    if st.session_state.get('current_conversation_id') and MONGODB_AVAILABLE:
        current_conv = next(
            (conv for conv in st.session_state.get('conversations', []) 
             if conv["_id"] == st.session_state.current_conversation_id), 
            None
        )
        if current_conv:
            st.info(f"{t('current_conversation')} **{current_conv['title']}** | {current_conv['updated_at'].strftime('%d/%m/%Y %H:%M') if isinstance(current_conv['updated_at'], datetime) else 'N/A'}")
        else:
            st.warning("⚠️ Cuộc trò chuyện hiện tại không tồn tại")
   
    

    # Display chat messages
    for message in st.session_state.messages:
        with st.chat_message(message["role"]):
            st.write(message["content"])

    # Floating language selector
    current_lang = st.session_state.language
    
    # Thay vì dùng JavaScript, tạo hai button để thay đổi ngôn ngữ
    st.markdown(f"""
    <style>
    .language-container {{
        position: fixed;
        bottom: 20px;
        left: 20px;
        z-index: 9999;
        display: flex;
        flex-direction: column;
        gap: 10px;
        align-items: center;
    }}
    
    .lang-float-button {{
        width: 50px;
        height: 50px;
        border-radius: 50%;
        background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
        color: white;
        font-size: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 15px rgba(220, 38, 38, 0.4);
        cursor: pointer;
        transition: all 0.3s ease;
        border: none;
    }}
    
    .lang-option {{
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background: white;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
        cursor: pointer;
        font-size: 20px;
        transition: all 0.3s ease;
        opacity: 0.9;
        border: 2px solid {("#dc2626" if current_lang == "vi" else "#e5e7eb")};
    }}
    
    .lang-option.en {{
        border: 2px solid {("#dc2626" if current_lang == "en" else "#e5e7eb")};
    }}
    
    .lang-option:hover {{
        transform: scale(1.1);
    }}
    </style>
    
    <div class="language-container">
        <a href="?lang=vi" target="_self" class="lang-option vi">🇻🇳</a>
        <a href="?lang=en" target="_self" class="lang-option en">🇬🇧</a>
    </div>
    """, unsafe_allow_html=True)

    

    # Handle suggested queries from file upload
    suggested_query = st.session_state.get('suggested_query', None)
    if suggested_query:
        st.session_state['suggested_query'] = None  # Clear after use
        user_query = suggested_query
    else:
        # Get user input
        user_query = st.chat_input(t("type_question"))

    # Process user input
    if user_query:
        # If no current conversation, create a new one
        if not st.session_state.current_conversation_id and MONGODB_AVAILABLE:
            with st.spinner(t("creating_conversation")):
                # Create title from first few words of query
                title_words = user_query.split()[:4]
                title = " ".join(title_words) + ("..." if len(user_query.split()) > 4 else "")
                
                new_conv = asyncio.run(create_new_conversation(st.session_state.username, title))
                if new_conv:
                    st.session_state.current_conversation_id = new_conv["_id"]
                    st.session_state.conversations.insert(0, new_conv)
        
        # Display user message
        st.session_state.messages.append({"role": "user", "content": user_query})
        st.session_state.conversation_history.append(HumanMessage(content=user_query))
        
        # Save user message to database
        if st.session_state.current_conversation_id and MONGODB_AVAILABLE:
            asyncio.run(save_message_to_conversation(
                st.session_state.current_conversation_id, 
                user_query, 
                is_user=True
            ))
        
        with st.chat_message("user"):
            st.write(user_query)

        # Show assistant "thinking"
        with st.chat_message("assistant"):
            with st.spinner(t("thinking")):
                try:
                    # Check if file chat agent is available
                    if hasattr(st.session_state, 'file_chat_agent') and st.session_state.file_chat_agent:
                        # Use file chat agent for uploaded file
                        bot_reply = st.session_state.file_chat_agent.chat(user_query)
                    elif "kma_chat_agent" in st.session_state and st.session_state.kma_chat_agent:
                        # Use KMA chat agent (original behavior from simplified file)
                        response = asyncio.run(
                            st.session_state.kma_chat_agent.chat_with_memory(
                                st.session_state.conversation_history,
                                user_query
                            )
                        )

                        # Save full history
                        st.session_state.conversation_history = response

                        # Get last message
                        last_message = response[-1] if response else None

                        if isinstance(last_message, AIMessage):
                            bot_reply = last_message.content
                        else:
                            bot_reply = "Xin lỗi, tôi không thể tạo phản hồi. Vui lòng thử câu hỏi khác."
                    else:
                        bot_reply = "Agent chưa được khởi tạo. Vui lòng thử lại sau."

                    st.session_state.messages.append({"role": "assistant", "content": bot_reply})
                    
                    # Save assistant message to database
                    if st.session_state.current_conversation_id and MONGODB_AVAILABLE:
                        asyncio.run(save_message_to_conversation(
                            st.session_state.current_conversation_id, 
                            bot_reply, 
                            is_user=False
                        ))
                    
                    st.write(bot_reply)

                except Exception as e:
                    error_msg = f"❌ Lỗi: {str(e)}"
                    st.session_state.messages.append({"role": "assistant", "content": error_msg})
                    st.error(error_msg)

    # Sidebar with conversation history and controls
    with st.sidebar:
            # Add button to return to feature selection
        if st.button(t("back_to_features"), key="back_to_features"):
            st.session_state.selected_feature = None
            st.rerun()
        # File Upload Section
        if FILE_UPLOAD_AVAILABLE:
            
            display_file_upload_sidebar()
            
            # Check if file is uploaded
            if 'file_chat_agent' in st.session_state:
                st.session_state.chat_mode = "📄 File đã upload"
            else:
                st.session_state.chat_mode = None
        else:
            st.session_state.chat_mode = None
            
        # Initialize KMA chat agent if not exists (for default chat when no file uploaded)
        if "kma_chat_agent" not in st.session_state:
            with st.spinner(t("initializing_agent")):
                try:
                    st.session_state.kma_chat_agent = ReActGraph()
                    st.session_state.kma_chat_agent.create_graph()
                    st.session_state.kma_chat_agent.print_mermaid()
                    
                except Exception as e:
                    st.error(f"{t('error_initializing')} {str(e)}")
                    st.info(t("features_unavailable"))
                    st.session_state.kma_chat_agent = None
            st.session_state.chat_mode = None
        
        # Conversation History Section
        st.markdown("---")
        st.markdown(f"### 💬 {t('conversation_list')}")
        
        # Initialize conversation state
        if "current_conversation_id" not in st.session_state:
            st.session_state.current_conversation_id = None
        if "conversations" not in st.session_state:
            st.session_state.conversations = []
        
        # Button to create a new conversation
        if st.button(t("new_conversation"), key="new_conversation"):
            if MONGODB_AVAILABLE:
                with st.spinner(t("creating_conversation")):
                    new_conv = asyncio.run(create_new_conversation(
                        st.session_state.username, 
                        f"Trò chuyện {datetime.now().strftime('%H:%M')}"
                    ))
                    if new_conv:
                        st.session_state.conversations.insert(0, new_conv)
                        st.session_state.current_conversation_id = new_conv["_id"]
                        # Clear current messages to start fresh
                        st.session_state.messages = []
                        st.session_state.conversation_history = []
                        st.success(t("conversation_loaded"))
                        st.rerun()
        
        # Display conversations list
        if st.session_state.conversations:
            st.markdown(f"**{t('conversation_list')}**")
            
            # Show current conversation indicator
            if st.session_state.current_conversation_id:
                current_conv = next(
                    (conv for conv in st.session_state.conversations 
                     if conv["_id"] == st.session_state.current_conversation_id), 
                    None
                )
                if current_conv:
                    st.info(f"{t('current_conversation')} {current_conv['title']}")
            
            # List all conversations
            for i, conv in enumerate(st.session_state.conversations[:10]):  # Show only 10 recent
                conv_time = conv["updated_at"].strftime("%d/%m %H:%M") if isinstance(conv["updated_at"], datetime) else "N/A"
                is_current = conv["_id"] == st.session_state.current_conversation_id
                
                # Highlight current conversation
                if is_current:
                    st.markdown(f"🔸 **{conv['title'][:25]}{'...' if len(conv['title']) > 25 else ''}**")
                    st.markdown(f"   *{conv_time}*")
                else:
                    if st.button(f"💬 {conv['title'][:25]}{'...' if len(conv['title']) > 25 else ''}", 
                               key=f"conv_{i}",
                               help=f"Cập nhật: {conv_time}"):
                        # Load this conversation
                        with st.spinner(t("loading_conversation")):
                            messages = asyncio.run(get_conversation_messages(conv["_id"]))
                            st.session_state.messages = messages
                            st.session_state.current_conversation_id = conv["_id"]
                            
                            # Convert messages to conversation history for agent
                            conv_history = []
                            for msg in messages:
                                if msg["role"] == "user":
                                    conv_history.append(HumanMessage(content=msg["content"]))
                                else:
                                    conv_history.append(AIMessage(content=msg["content"]))
                            st.session_state.conversation_history = conv_history
                            
                            
                            st.success(f"{t('conversation_loaded')} {conv['title']}")
                            st.rerun()
        else:
            st.info(t("no_conversations"))
        
       

 

if __name__ == "__main__":
    main()