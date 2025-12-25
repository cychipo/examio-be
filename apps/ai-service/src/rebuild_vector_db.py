"""Rebuild vector database với table-aware chunking"""
import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

from rag.retriever import create_enhanced_vector_database

def rebuild_vector_database():
    """Rebuild vector database với enhanced table chunking"""
    print("=== REBUILDING VECTOR DATABASE WITH TABLE-AWARE CHUNKING ===")
    
    data_dir = r"d:\KMA_ChatBot_Frontend_System\chatbot_agent\data"
    vector_db_dir = r"d:\KMA_ChatBot_Frontend_System\chatbot_agent\vector_db"
    
    try:
        # Delete existing vector database
        if os.path.exists(vector_db_dir):
            import shutil
            shutil.rmtree(vector_db_dir)
            print("✅ Deleted old vector database")
        
        # Create new enhanced vector database
        print("🔄 Creating new vector database with table-aware chunking...")
        documents = create_enhanced_vector_database(vector_db_dir, data_dir)
        
        print(f"✅ Successfully created vector database with {len(documents)} documents")
        
        # Show chunking summary
        table_chunks = [doc for doc in documents if doc.metadata.get('contains_table', False)]
        text_chunks = [doc for doc in documents if not doc.metadata.get('contains_table', False)]
        
        print(f"📊 Chunking Summary:")
        print(f"   📋 Table chunks: {len(table_chunks)}")
        print(f"   📄 Text chunks: {len(text_chunks)}")
        print(f"   📦 Total chunks: {len(documents)}")
        
        # Show sample table chunk
        if table_chunks:
            print(f"\n🔍 Sample table chunk:")
            sample_table = table_chunks[0]
            print(f"Metadata: {sample_table.metadata}")
            print(f"Content preview:")
            print(sample_table.page_content[:500] + "..." if len(sample_table.page_content) > 500 else sample_table.page_content)
        
        return True
        
    except Exception as e:
        print(f"❌ Error rebuilding vector database: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = rebuild_vector_database()
    if success:
        print("\n🎉 VECTOR DATABASE REBUILD COMPLETE!")
        print("Now testing với table query...")
        
        # Quick test
        from debug_table_chunking import debug_table_chunking
        debug_table_chunking()
    else:
        print("\n❌ REBUILD FAILED!")