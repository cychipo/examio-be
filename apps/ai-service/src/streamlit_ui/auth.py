import streamlit as st
import json
import hashlib
import os
import sys
import asyncio
import secrets
from datetime import datetime

# Add the parent directory to sys.path to import backend modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Import appbar components
try:
    from appbar import create_appbar, create_simple_appbar
    APPBAR_AVAILABLE = True
except ImportError:
    APPBAR_AVAILABLE = False

try:
    from backend.db.mongodb import mongodb
    MONGODB_AVAILABLE = True
except ImportError as e:
    st.error(f"Cannot import MongoDB: {e}")
    MONGODB_AVAILABLE = False

# Hàm băm mật khẩu
def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()

# Hàm tạo salt ngẫu nhiên cho bảo mật tốt hơn
def generate_salt():
    return secrets.token_hex(16)

# Hàm băm mật khẩu với salt
def hash_password_with_salt(password, salt):
    return hashlib.sha256((password + salt).encode()).hexdigest()

# MongoDB functions
async def init_mongodb():
    """Initialize MongoDB connection"""
    try:
        if mongodb.client is None:
            await mongodb.connect_to_mongodb()
        return True
    except Exception as e:
        st.error(f"❌ MongoDB connection error: {str(e)}")
        return False

async def save_user_to_db(username: str, password: str, email: str = None):
    """Save user to MongoDB with salt-based password hashing"""
    try:
        if not MONGODB_AVAILABLE:
            st.error("❌ MongoDB không khả dụng")
            return False
        
        # Initialize connection
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
        st.error(f"❌ Lỗi lưu user: {str(e)}")
        return False

async def find_user_in_db(username: str):
    """Find user in MongoDB"""
    try:
        if not MONGODB_AVAILABLE:
            return None
        
        if not await init_mongodb():
            return None
        
        def do_find():
            return mongodb.db.users.find_one({"username": username})
        
        user = await asyncio.get_event_loop().run_in_executor(None, do_find)
        return user
        
    except Exception as e:
        st.error(f"❌ Lỗi tìm user: {str(e)}")
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
        
        # Fallback: simple hash (old method for backward compatibility)
        return user.get("password_hash") == hash_password(password)
        
    except Exception as e:
        st.error(f"❌ Lỗi xác thực: {str(e)}")
        return False

# Load dữ liệu người dùng từ file
def load_users():
    if os.path.exists("users.json"):
        with open("users.json", "r") as f:
            return json.load(f)
    return {}

# Lưu dữ liệu người dùng
def save_users(users):
    with open("users.json", "w") as f:
        json.dump(users, f, indent=4)

# Giao diện đăng nhập
def login():
    # Custom CSS cho form đăng nhập
    st.markdown("""
    <style>
    .login-container {
        background: linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%);
        padding: 2rem;
        border-radius: 15px;
        box-shadow: 0 4px 20px rgba(220, 20, 60, 0.1);
        border: 2px solid #dc143c;
        margin: 1rem 0;
    }
    
    .login-header {
        text-align: center;
        color: #dc143c;
        font-size: 1.8rem;
        font-weight: bold;
        margin-bottom: 1.5rem;
        text-shadow: 1px 1px 2px rgba(220, 20, 60, 0.1);
    }
    
    .login-icon {
        font-size: 3rem;
        text-align: center;
        margin-bottom: 1rem;
        color: #dc143c;
    }
    </style>
    """, unsafe_allow_html=True)
    
    # Container cho form đăng nhập
    st.markdown('<div class="login-container">', unsafe_allow_html=True)
    
    # Header với icon
    st.markdown('<div class="login-icon">🔐</div>', unsafe_allow_html=True)
    st.markdown('<div class="login-header">ĐĂNG NHẬP VÀO HỆ THỐNG</div>', unsafe_allow_html=True)
    
    # Form đăng nhập với layout đẹp hơn
    with st.form("login_form", clear_on_submit=False):
        col1, col2, col3 = st.columns([1, 3, 1])
        
        with col2:
            # Input fields với placeholder và icon
            username = st.text_input(
                "👤 Tên đăng nhập", 
                placeholder="Nhập tên đăng nhập của bạn...",
                help="Tên đăng nhập đã được đăng ký trong hệ thống"
            )
            
            password = st.text_input(
                "🔒 Mật khẩu", 
                type="password",
                placeholder="Nhập mật khẩu...",
                help="Mật khẩu có phân biệt chữ hoa/thường"
            )
            
            st.markdown("<br>", unsafe_allow_html=True)
            
            # Nút đăng nhập với style đẹp
            col_btn1, col_btn2, col_btn3 = st.columns([1, 2, 1])
            with col_btn2:
                submitted = st.form_submit_button(
                    "🚀 ĐĂNG NHẬP", 
                    use_container_width=True,
                    type="primary"
                )
        
        if submitted:
            if not username or not password:
                st.error("⚠️ Vui lòng nhập đầy đủ thông tin đăng nhập!")
                st.markdown('</div>', unsafe_allow_html=True)
                return
            
            with st.spinner("🔄 Đang xác thực thông tin..."):
                if MONGODB_AVAILABLE:
                    # Use MongoDB authentication
                    login_success = asyncio.run(verify_user_password(username, password))
                else:
                    # Fallback to JSON file
                    users = load_users()
                    login_success = username in users and users[username] == hash_password(password)
                
                if login_success:
                    st.success(f"🎉 Chào mừng {username} đến với hệ thống KMA!")
                    st.session_state["logged_in"] = True
                    st.session_state["username"] = username
                    st.balloons()
                    st.rerun()
                else:
                    st.error("❌ Thông tin đăng nhập không chính xác. Vui lòng kiểm tra lại!")
    
    st.markdown('</div>', unsafe_allow_html=True)

# Giao diện đăng ký
def register():
    # Custom CSS cho form đăng ký
    st.markdown("""
    <style>
    .register-container {
        background: linear-gradient(135deg, #ffffff 0%, #f0f8ff 100%);
        padding: 2rem;
        border-radius: 15px;
        box-shadow: 0 4px 20px rgba(25, 135, 84, 0.1);
        border: 2px solid #198754;
        margin: 1rem 0;
    }
    
    .register-header {
        text-align: center;
        color: #198754;
        font-size: 1.8rem;
        font-weight: bold;
        margin-bottom: 1.5rem;
        text-shadow: 1px 1px 2px rgba(25, 135, 84, 0.1);
    }
    
    .register-icon {
        font-size: 3rem;
        text-align: center;
        margin-bottom: 1rem;
        color: #198754;
    }
    
    .password-strength {
        font-size: 0.85rem;
        color: #666;
        margin-top: 0.25rem;
    }
    </style>
    """, unsafe_allow_html=True)
    
    # Container cho form đăng ký
    st.markdown('<div class="register-container">', unsafe_allow_html=True)
    
    # Header với icon
    st.markdown('<div class="register-icon">📝</div>', unsafe_allow_html=True)
    st.markdown('<div class="register-header">TẠO TÀI KHOẢN MỚI</div>', unsafe_allow_html=True)
    
    # Form đăng ký với layout đẹp hơn
    with st.form("register_form", clear_on_submit=False):
        col1, col2, col3 = st.columns([1, 3, 1])
        
        with col2:
            # Input fields với validation và help text
            username = st.text_input(
                "👤 Tên đăng nhập", 
                placeholder="Chọn tên đăng nhập duy nhất...",
                help="Tên đăng nhập phải từ 3-20 ký tự, chỉ chứa chữ cái, số và dấu gạch dưới"
            )
            
            email = st.text_input(
                "📧 Email (tùy chọn)", 
                placeholder="your.email@example.com",
                help="Email sẽ được dùng để khôi phục mật khẩu nếu cần"
            )
            
            col_pass1, col_pass2 = st.columns(2)
            
            with col_pass1:
                password = st.text_input(
                    "🔒 Mật khẩu", 
                    type="password",
                    placeholder="Tối thiểu 6 ký tự...",
                    help="Mật khẩu mạnh nên chứa chữ hoa, chữ thường, số và ký tự đặc biệt"
                )
            
            with col_pass2:
                confirm = st.text_input(
                    "🔐 Xác nhận mật khẩu", 
                    type="password",
                    placeholder="Nhập lại mật khẩu...",
                    help="Nhập lại mật khẩu để xác nhận"
                )
            
            # Password strength indicator
            if password:
                strength_score = 0
                strength_text = []
                
                if len(password) >= 6:
                    strength_score += 1
                    strength_text.append("✅ Độ dài phù hợp")
                else:
                    strength_text.append("❌ Cần ít nhất 6 ký tự")
                
                if any(c.isupper() for c in password):
                    strength_score += 1
                    strength_text.append("✅ Có chữ hoa")
                else:
                    strength_text.append("⚠️ Nên có chữ hoa")
                
                if any(c.isdigit() for c in password):
                    strength_score += 1
                    strength_text.append("✅ Có số")
                else:
                    strength_text.append("⚠️ Nên có số")
                
                if any(c in "!@#$%^&*(),.?\":{}|<>" for c in password):
                    strength_score += 1
                    strength_text.append("✅ Có ký tự đặc biệt")
                else:
                    strength_text.append("⚠️ Nên có ký tự đặc biệt")
                
                # Display strength
                if strength_score == 4:
                    st.success("🛡️ **Mật khẩu rất mạnh!**")
                elif strength_score >= 2:
                    st.warning("🔒 **Mật khẩu tốt** - " + " | ".join(strength_text[:2]))
                else:
                    st.error("⚠️ **Mật khẩu yếu** - " + strength_text[0])
            
            # Password match check
            if password and confirm:
                if password == confirm:
                    st.success("✅ Mật khẩu khớp!")
                else:
                    st.error("❌ Mật khẩu không khớp!")
            
            st.markdown("<br>", unsafe_allow_html=True)
            
            # Checkbox đồng ý điều khoản
            agree_terms = st.checkbox(
                "📋 Tôi đồng ý với **Điều khoản sử dụng** và **Chính sách bảo mật**",
                help="Bạn cần đồng ý để tạo tài khoản"
            )
            
            st.markdown("<br>", unsafe_allow_html=True)
            
            # Nút đăng ký với style đẹp
            col_btn1, col_btn2, col_btn3 = st.columns([1, 2, 1])
            with col_btn2:
                submitted = st.form_submit_button(
                    "🎯 TẠO TÀI KHOẢN", 
                    use_container_width=True,
                    type="primary",
                    disabled=not agree_terms
                )
        
        if submitted:
            # Validation
            if not username or not password:
                st.error("⚠️ Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu!")
                st.markdown('</div>', unsafe_allow_html=True)
                return
            
            if len(username) < 3:
                st.error("❌ Tên đăng nhập phải có ít nhất 3 ký tự!")
                st.markdown('</div>', unsafe_allow_html=True)
                return
            
            if password != confirm:
                st.error("❌ Mật khẩu xác nhận không khớp!")
                st.markdown('</div>', unsafe_allow_html=True)
                return
            
            if len(password) < 6:
                st.error("❌ Mật khẩu phải có ít nhất 6 ký tự!")
                st.markdown('</div>', unsafe_allow_html=True)
                return
            
            if not agree_terms:
                st.error("❌ Vui lòng đồng ý với điều khoản sử dụng!")
                st.markdown('</div>', unsafe_allow_html=True)
                return
            
            with st.spinner("🔄 Đang tạo tài khoản mới..."):
                if MONGODB_AVAILABLE:
                    # Check if user exists in MongoDB
                    existing_user = asyncio.run(find_user_in_db(username))
                    if existing_user:
                        st.warning("⚠️ Tên đăng nhập đã được sử dụng. Vui lòng chọn tên khác!")
                        st.markdown('</div>', unsafe_allow_html=True)
                        return
                    
                    # Save to MongoDB
                    save_success = asyncio.run(save_user_to_db(username, password, email))
                    if save_success:
                        st.success("🎉 Đăng ký thành công! Bạn có thể đăng nhập ngay bây giờ.")
                        st.balloons()
                        # Auto switch to login tab hint
                        st.info("💡 **Mẹo:** Chuyển sang tab 'Đăng nhập' để truy cập hệ thống!")
                    else:
                        st.error("❌ Đăng ký thất bại. Vui lòng thử lại sau!")
                else:
                    # Fallback to JSON file
                    users = load_users()
                    if username in users:
                        st.warning("⚠️ Tên đăng nhập đã được sử dụng. Vui lòng chọn tên khác!")
                    else:
                        users[username] = hash_password(password)
                        save_users(users)
                        st.success("🎉 Đăng ký thành công! Bạn có thể đăng nhập ngay bây giờ.")
                        st.balloons()
                        st.info("💡 **Mẹo:** Chuyển sang tab 'Đăng nhập' để truy cập hệ thống!")
    
    st.markdown('</div>', unsafe_allow_html=True)

# Giao diện chính sau khi đăng nhập
def main_app():
    username = st.session_state.get('username', 'Unknown')
    
    # Header with logout button
    col1, col2, col3 = st.columns([3, 1, 1])
    
    with col1:
        st.title(f"🎉 Xin chào, {username}!")
    
    with col3:
        if st.button("🚪 Đăng xuất", type="primary"):
            st.session_state["logged_in"] = False
            st.session_state["username"] = ""
            st.success("✅ Đã đăng xuất thành công!")
            st.rerun()
    
    st.markdown("---")
    
    # Display user info from database
    if MONGODB_AVAILABLE:
        with st.spinner("🔄 Đang tải thông tin người dùng..."):
            user_info = asyncio.run(find_user_in_db(username))
            
            if user_info:
                col1, col2 = st.columns(2)
                
                with col1:
                    st.info("👤 **Thông tin tài khoản**")
                    st.write(f"**Tên đăng nhập:** {user_info.get('username', 'N/A')}")
                    if user_info.get('email'):
                        st.write(f"**Email:** {user_info['email']}")
                    st.write(f"**Bảo mật:** Salt + Hash")
                
                with col2:
                    st.info("📅 **Thông tin hệ thống**")
                    if user_info.get('created_at'):
                        st.write(f"**Ngày tạo:** {user_info['created_at'].strftime('%d/%m/%Y %H:%M')}")
                    if user_info.get('updated_at'):
                        st.write(f"**Cập nhật:** {user_info['updated_at'].strftime('%d/%m/%Y %H:%M')}")
                    st.write(f"**Database:** MongoDB Atlas")
            else:
                st.warning("⚠️ Không thể tải thông tin người dùng từ database")
    else:
        st.info("💾 **Đang sử dụng JSON file storage (fallback mode)**")
    
    st.markdown("---")
    
    # Main content tabs
    tab1, tab2, tab3 = st.tabs(["🤖 Chatbot", "👤 Thông tin cá nhân", "⚙️ Cài đặt"])
    
    with tab1:
        st.markdown("### 🤖 KMA Chatbot Assistant")
        st.info("🚧 Tính năng chatbot sẽ được tích hợp từ streamlit_app.py")
        st.markdown("""
        **Tính năng sẽ có:**
        - 💬 Chat với AI Assistant
        - 📚 Tra cứu quy định KMA
        - 📊 Xem điểm số và thống kê
        - 🎓 Hỗ trợ học tập
        """)
        
        if st.button("🚀 Chuyển đến Chatbot"):
            st.info("Tính năng này sẽ chuyển hướng đến trang chatbot chính")
    
    with tab2:
        st.markdown("### 👤 Thông tin cá nhân")
        
        if MONGODB_AVAILABLE:
            st.info("🔄 Tính năng cập nhật thông tin đang phát triển")
            
            with st.form("update_profile"):
                new_email = st.text_input("Email mới (tùy chọn)")
                if st.form_submit_button("Cập nhật thông tin"):
                    st.info("Tính năng cập nhật sẽ được bổ sung sau")
        else:
            st.warning("Tính năng này chỉ khả dụng khi kết nối MongoDB")
    
    with tab3:
        st.markdown("### ⚙️ Cài đặt tài khoản")
        
        with st.expander("🔐 Đổi mật khẩu"):
            with st.form("change_password"):
                current_password = st.text_input("Mật khẩu hiện tại", type="password")
                new_password = st.text_input("Mật khẩu mới", type="password")
                confirm_new_password = st.text_input("Xác nhận mật khẩu mới", type="password")
                
                if st.form_submit_button("Đổi mật khẩu"):
                    st.info("🔄 Tính năng đổi mật khẩu đang phát triển")
        
        with st.expander("🗑️ Xóa tài khoản"):
            st.warning("⚠️ **Cảnh báo:** Hành động này không thể hoàn tác!")
            confirm_delete = st.text_input("Nhập 'DELETE' để xác nhận:")
            if st.button("Xóa tài khoản", type="secondary"):
                if confirm_delete == "DELETE":
                    st.error("🔄 Tính năng xóa tài khoản đang phát triển")
                else:
                    st.warning("Vui lòng nhập 'DELETE' để xác nhận")
    
    # Sidebar with user stats
    with st.sidebar:
        st.markdown("### 👤 Thông tin phiên làm việc")
        st.write(f"**User:** {username}")
        st.write(f"**Status:** 🟢 Online")
        st.write(f"**Database:** {'🟢 MongoDB' if MONGODB_AVAILABLE else '🟡 JSON'}")
        
        st.markdown("---")
        
        st.markdown("### 📊 Thống kê")
        st.write("**Phiên đăng nhập:** Hoạt động")
        st.write("**Bảo mật:** Mã hóa")
        
        if st.button("🔄 Làm mới thông tin"):
            st.rerun()

# Giao diện lựa chọn
def main():
    st.set_page_config(
        page_title="HỌC VIỆN KỸ THUẬT MẬT MÃ - Hệ thống xác thực", 
        page_icon="�️", 
        layout="wide",
        initial_sidebar_state="expanded"
    )
    
    # CSS cho toàn bộ trang
    st.markdown("""
    <style>
    .main-header {
        text-align: center;
        padding: 1rem 0;
        margin-bottom: 2rem;
    }
    
    .auth-tabs {
        background: rgba(255, 255, 255, 0.05);
        border-radius: 10px;
        padding: 1rem;
        margin: 1rem 0;
    }
    
    .status-container {
        background: linear-gradient(90deg, #f8f9fa 0%, #ffffff 100%);
        padding: 1rem;
        border-radius: 10px;
        border-left: 4px solid #dc143c;
        margin: 1rem 0;
    }
    </style>
    """, unsafe_allow_html=True)
    
    # Show KMA App Bar
    if APPBAR_AVAILABLE:
        create_appbar()
    else:
        # Fallback header
        st.markdown("""
        <div class="main-header">
            <h1 style="color: #dc143c; font-size: 2.5rem; margin: 0;">
                🛡️ HỌC VIỆN KỸ THUẬT MẬT MÃ
            </h1>
            <p style="color: #666; font-size: 1.2rem; margin: 0.5rem 0;">
                Hệ thống xác thực KMA Assistant
            </p>
        </div>
        """, unsafe_allow_html=True)

    # Initialize session state
    if "logged_in" not in st.session_state:
        st.session_state["logged_in"] = False
        st.session_state["username"] = ""

    if st.session_state["logged_in"]:
        main_app()
    else:
        # Status indicator với design đẹp hơn
        st.markdown('<div class="status-container">', unsafe_allow_html=True)
        col1, col2, col3 = st.columns([2, 1, 1])
        
        with col1:
            st.markdown("### 🔐 **Truy cập an toàn vào hệ thống KMA**")
            st.markdown("Vui lòng đăng nhập hoặc tạo tài khoản mới để sử dụng KMA Assistant")
        
        with col2:
            if MONGODB_AVAILABLE:
                st.success("🟢 **MongoDB Atlas**")
                st.caption("Kết nối bảo mật")
            else:
                st.warning("🟡 **JSON Fallback**")
                st.caption("Chế độ dự phòng")
        
        with col3:
            st.info("🛡️ **Bảo mật cao**")
            st.caption("Salt + SHA-256")
        
        st.markdown('</div>', unsafe_allow_html=True)
        
        # Tab interface với style đẹp hơn
        st.markdown('<div class="auth-tabs">', unsafe_allow_html=True)
        
        tab1, tab2 = st.tabs([
            "🔐 **ĐĂNG NHẬP**", 
            "📝 **ĐĂNG KÝ THÀNH VIÊN**"
        ])
        
        with tab1:
            login()
        
        with tab2:
            register()
        
        st.markdown('</div>', unsafe_allow_html=True)
        
        # Additional information
        st.markdown("---")
        with st.expander("ℹ️ Thông tin hệ thống"):
            col1, col2 = st.columns(2)
            
            with col1:
                st.markdown("""
                **🛡️ Bảo mật:**
                - Mã hóa mật khẩu với Salt + SHA-256
                - Lưu trữ an toàn trên MongoDB
                - Không lưu mật khẩu gốc
                - Session management bảo mật
                """)
            
            with col2:
                st.markdown("""
                **💾 Database:**
                - MongoDB Atlas Cloud
                - Tự động backup
                - High availability
                - Encrypted connections
                """)
        
        # Sidebar information
        with st.sidebar:
            st.markdown("### 📊 Trạng thái hệ thống")
            
            if MONGODB_AVAILABLE:
                st.success("🟢 MongoDB Atlas")
                st.info("🔒 Mã hóa Salt + Hash")
            else:
                st.warning("🟡 JSON File Storage")
                st.info("🔒 Mã hóa SHA-256")
            
            st.markdown("---")
            
            st.markdown("### 🚀 Tính năng")
            st.markdown("""
            - 🔐 Đăng ký/Đăng nhập an toàn
            - 🤖 Chat với KMA Assistant
            - 📚 Tra cứu thông tin KMA
            - 📊 Hỗ trợ học tập
            """)
            
            # Debug info for MongoDB
            if st.checkbox("🐛 Debug Info"):
                st.write(f"MongoDB Available: {MONGODB_AVAILABLE}")
                st.write(f"Current User: {st.session_state.get('username', 'None')}")
                st.write(f"Logged In: {st.session_state.get('logged_in', False)}")

if __name__ == "__main__":
    main()
