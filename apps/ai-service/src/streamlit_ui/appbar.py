import streamlit as st
import base64

def get_base64_image(image_path):
    """Convert image to base64 string"""
    try:
        with open(image_path, "rb") as img_file:
            return base64.b64encode(img_file.read()).decode()
    except:
        return None

def create_appbar():
    """Create an attractive app bar for KMA (Học viện Kỹ thuật Mật mã)"""
    
    # Get base64 image
    img_base64 = get_base64_image("./img/kma.png")
    
    # Custom CSS for the app bar
    st.markdown("""
    <style>
    .kma-appbar {
        background: linear-gradient(135deg, #dc143c 0%, #b91c1c 50%, #ffffff 100%);
        padding: 1.5rem 2rem;
        
        border-radius: 0px;
        margin-bottom: 2rem;
        margin-top: -4rem;
        box-shadow: 0 6px 20px rgba(220, 20, 60, 0.3);
        border-bottom: 4px solid #dc143c;
        border-top: none;
        position: relative;
        text-align: center;
    }
    
    .kma-logo-section {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1rem;
        margin-bottom: 1rem;
    }
    
    .kma-logo-img {
        width: 100px;
        height: 100px;
        border-radius: 50%;
        border: 4px solid #dc143c;
        box-shadow: 0 4px 12px rgba(220, 20, 60, 0.4);
        background: white;
        padding: 8px;
        object-fit: contain;
    }
    
    .kma-title {
        color: white !important;
        font-size: 2.6rem;
        font-weight: 900;
        text-align: center;
        margin: 0;
        text-shadow: 1px 1px 2px rgba(255, 255, 255, 0.3), 2px 2px 4px rgba(255, 255, 255, 0.2);
        font-family: 'Impact', 'Arial Black', sans-serif;
        letter-spacing: 2px;
        text-transform: uppercase;
    }
    
    .kma-subtitle {
        color: #ffffff;
        font-size: 1.4rem;
        text-align: center;
        margin: 0.8rem 0 0 0;
        font-weight: 700;
        text-shadow: 2px 2px 0px #dc143c, 4px 4px 8px rgba(0, 0, 0, 0.4);
        font-style: normal;
        letter-spacing: 1px;
        text-transform: uppercase;
    }
                
    </style>
    """, unsafe_allow_html=True)
    st.markdown("""
    <style>
        #MainMenu {visibility: hidden;}
        header {visibility: hidden;}
        footer {visibility: hidden;}
        button[title="View app menu"] {
            display: none;
        }
        a[href^="https://share.streamlit.io"] {
            display: none !important;
        }
    </style>
""", unsafe_allow_html=True)

    # App bar HTML with embedded image
    if img_base64:
        logo_html = f'<img src="data:image/png;base64,{img_base64}" class="kma-logo-img" alt="KMA Logo">'
    else:
        logo_html = '<div style="font-size: 4rem; color: #dc143c;">🛡️</div>'
    
    st.markdown(f"""
    <div class="kma-appbar">
        <div class="kma-logo-section">
            {logo_html}
            <div>
                <h1 class="kma-title">HỌC VIỆN KỸ THUẬT MẬT MÃ</h1>
                <p class="kma-subtitle">ACADEMY OF CRYPTOGRAPHY TECHNIQUES</p>
            </div>
        </div>
    </div>
    """, unsafe_allow_html=True)

def create_simple_appbar():
    """Create a simple version of the app bar"""
    # Get base64 image
    img_base64 = get_base64_image("img/kma.png")
    
    if img_base64:
        logo_html = f'<img src="data:image/png;base64,{img_base64}" style="width: 60px; height: 60px; border-radius: 50%; border: 3px solid #dc143c; margin-bottom: 1rem; background: white; padding: 3px;" alt="KMA Logo">'
    else:
        logo_html = '<div style="font-size: 2rem; margin-bottom: 1rem; color: #dc143c;">🛡️</div>'
    
    st.markdown(f"""
    <div style="
        background: linear-gradient(90deg, #dc143c 0%, #ffffff 100%);
        padding: 1.5rem;
        border-radius: 0px;
        margin-bottom: 1.5rem;
        margin-top: -1rem;
        text-align: center;
        border-bottom: 3px solid #dc143c;
        border-top: none;
        box-shadow: 0 4px 12px rgba(220, 20, 60, 0.2);
    ">
        {logo_html}
        <h2 style="
            color: #ffffff;
            margin: 0;
            font-size: 2rem;
            text-shadow: 1px 1px 2px rgba(255, 255, 255, 0.3), 2px 2px 3px rgba(255, 255, 255, 0.2);
            font-weight: 900;
            letter-spacing: 1.5px;
            text-transform: uppercase;
            font-family: 'Impact', 'Arial Black', sans-serif;
        ">HỌC VIỆN KỸ THUẬT MẬT MÃ</h2>
        <p style="
            color: #ffffff;
            margin: 0.8rem 0 0 0;
            font-size: 1.1rem;
            font-weight: 700;
            text-shadow: 1px 1px 0px #dc143c, 2px 2px 6px rgba(0, 0, 0, 0.3);
            letter-spacing: 1px;
        ">KMA ASSISTANT - TRỢ LÝ ẢO THÔNG MINH</p>
    </div>
    """, unsafe_allow_html=True)

def create_compact_appbar(user_name=None):
    """Create a compact version of the app bar with user info"""
    user_display = f"👤 {user_name}" if user_name else "👤 Guest"
    
    # Get base64 image
    img_base64 = get_base64_image("img/kma.png")
    
    if img_base64:
        logo_html = f'<img src="data:image/png;base64,{img_base64}" style="width: 40px; height: 40px; border-radius: 50%; border: 2px solid #dc143c; margin-right: 1rem; background: white; padding: 2px;" alt="KMA Logo">'
    else:
        logo_html = '<span style="font-size: 1.5rem; margin-right: 1rem; color: #dc143c;">🛡️</span>'
    
    st.markdown(f"""
    <div style="
        background: linear-gradient(90deg, #dc143c 0%, #ffffff 100%);
        padding: 1rem 1.5rem;
        border-radius: 8px;
        margin-bottom: 1rem;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 3px solid #dc143c;
        border-top: 2px solid #ffffff;
        box-shadow: 0 2px 8px rgba(220, 20, 60, 0.2);
    ">
        <div style="display: flex; align-items: center;">
            {logo_html}
            <h3 style="
                color: #ffffff;
                margin: 0;
                font-size: 1.4rem;
                text-shadow: 1px 1px 2px rgba(255, 255, 255, 0.3), 2px 2px 3px rgba(255, 255, 255, 0.2);
                font-weight: 900;
                letter-spacing: 1px;
                text-transform: uppercase;
                font-family: 'Impact', 'Arial Black', sans-serif;
            ">HỌC VIỆN KỸ THUẬT MẬT MÃ</h3>
        </div>
        <div style="
            color: #ffffff;
            font-weight: 700;
            font-size: 1rem;
            text-shadow: 1px 1px 0px #dc143c, 2px 2px 4px rgba(0, 0, 0, 0.3);
            letter-spacing: 0.5px;
        ">{user_display}</div>
    </div>
    """, unsafe_allow_html=True)
