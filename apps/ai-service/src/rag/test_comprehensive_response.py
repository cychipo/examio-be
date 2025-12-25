"""
Test script to validate comprehensive response with improved chunk settings
"""
import os
import sys
from pathlib import Path

# Add the src directory to the Python path
current_dir = Path(__file__).parent
src_dir = current_dir.parent
sys.path.insert(0, str(src_dir))

from rag.retriever import MetadataEnhancedHybridRetriever
#!/usr/bin/env python3
"""
Test Comprehensive Response System - Cải thiện câu trả lời đầy đủ hơn
"""

import os
import sys
from typing import List, Dict, Any

# Add project root to path
project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.append(project_root)
sys.path.append(os.path.join(project_root, "src"))

from llm.config import LLMConfig, get_llm
import asyncio

async def test_comprehensive_grading_response():
    """Test comprehensive response about grading systems"""
    print("🔧 Testing comprehensive response with enhanced chunk settings...")
    
    # Initialize retriever with enhanced settings
    retriever = MetadataEnhancedHybridRetriever(
        data_path="d:/KMA_ChatBot_Frontend_System/chatbot_agent/data"
    )
    
    # Initialize vector database
    print("📚 Creating enhanced vector database...")
    vectorstore = retriever.create_enhanced_vector_database()
    
    # Test query about grading systems
    query = "các loại thang điểm đánh giá"
    print(f"\n❓ Query: {query}")
    
    # Retrieve relevant documents with increased context
    print("🔍 Retrieving relevant documents...")
    retrieved_docs = retriever.retrieve_with_metadata_filter(
        query=query,
        k=8,  # Increase number of retrieved docs
        metadata_filter=None
    )
    
    print(f"📄 Retrieved {len(retrieved_docs)} documents")
    
    # Display retrieved content for analysis
    print("\n📋 Retrieved Content Analysis:")
    for i, doc in enumerate(retrieved_docs):
        print(f"\n--- Document {i+1} ---")
        print(f"Source: {doc.metadata.get('source', 'Unknown')}")
        print(f"Content length: {len(doc.page_content)} characters")
        print(f"Content preview: {doc.page_content[:200]}...")
        if 'thang điểm' in doc.page_content.lower():
            print("✅ Contains grading scale information")
    
    # Initialize LLM
    print("\n🤖 Initializing LLM...")
    llm = get_llm()
    
    # Create comprehensive context
    context = "\n\n".join([doc.page_content for doc in retrieved_docs])
    
    # Enhanced prompt for comprehensive response
    comprehensive_prompt = f"""
Dựa vào thông tin sau, hãy trả lời một cách chi tiết và đầy đủ về các loại thang điểm đánh giá:

{context}

Câu hỏi: {query}

Yêu cầu trả lời:
- Liệt kê TẤT CẢ các loại thang điểm được đề cập
- Mô tả chi tiết từng loại thang điểm
- Bao gồm các bảng quy đổi điểm (nếu có)
- Giải thích các ký hiệu đặc biệt (I, X, etc.)
- Cung cấp ví dụ cụ thể cho mỗi loại thang điểm

Trả lời:
"""
    
    print("💭 Generating comprehensive response...")
    response = await llm.generate_response(comprehensive_prompt)
    
    print("\n" + "="*80)
    print("📝 COMPREHENSIVE RESPONSE:")
    print("="*80)
    print(response)
    print("="*80)
    
    # Analyze response completeness
    print("\n📊 Response Analysis:")
    keywords_to_check = [
        "thang điểm 10", "thang điểm 4", "thang điểm chữ",
        "quy đổi", "bảng điểm", "A", "B", "C", "D", "F",
        "I", "X", "ký hiệu"
    ]
    
    found_keywords = []
    for keyword in keywords_to_check:
        if keyword.lower() in response.lower():
            found_keywords.append(keyword)
    
    print(f"✅ Found keywords: {found_keywords}")
    print(f"📈 Coverage: {len(found_keywords)}/{len(keywords_to_check)} keywords")
    print(f"📏 Response length: {len(response)} characters")
    
    if len(found_keywords) >= len(keywords_to_check) * 0.7:
        print("🎉 Response appears comprehensive!")
    else:
        print("⚠️ Response may need improvement")

if __name__ == "__main__":
    asyncio.run(test_comprehensive_grading_response())