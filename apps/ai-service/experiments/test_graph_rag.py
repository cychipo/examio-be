"""
Test Graph RAG system for evaluation
"""
import os
import sys

# Add parent directory to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.append(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'src'))

def test_graph_rag_imports():
    """Test if Graph RAG can be imported"""
    try:
        from llm.config import get_gemini_llm
        print("✅ Gemini LLM import successful")
    except ImportError as e:
        print(f"❌ Gemini LLM import failed: {e}")
        return False
    
    try:
        from graph_rag import GraphRoutedRetriever, DocumentGraph, SubgraphPartitioner
        print("✅ Graph RAG imports successful")
    except ImportError as e:
        print(f"❌ Graph RAG imports failed: {e}")
        return False
    
    return True

def test_graph_rag_initialization():
    """Test Graph RAG initialization"""
    try:
        from graph_rag import GraphRoutedRetriever, DocumentGraph, SubgraphPartitioner
        
        # Paths
        current_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        graph_cache_dir = os.path.join(current_dir, "document_graph")
        
        print(f"📊 Graph cache directory: {graph_cache_dir}")
        print(f"📁 Cache exists: {os.path.exists(graph_cache_dir)}")
        
        if os.path.exists(graph_cache_dir):
            files = os.listdir(graph_cache_dir)
            print(f"📄 Cache files: {files}")
        
        # Load graph
        graph_cache_file = os.path.join(graph_cache_dir, "graph.pkl")
        graph_builder = DocumentGraph()
        graph_builder.load_graph(graph_cache_file)  # Pass file path, not directory
        graph = graph_builder.graph
        
        print(f"✅ Graph loaded: {graph.number_of_nodes()} nodes, {graph.number_of_edges()} edges")
        
        # Load partitioner (automatically partitions the graph)
        partitioner = SubgraphPartitioner(graph)
        # Run community detection to populate communities
        partitioner.partition_by_community_detection(algorithm='louvain')
        
        print(f"✅ Partitioner loaded: {len(partitioner.communities)} communities")
        
        # Create retriever
        retriever = GraphRoutedRetriever(
            graph=graph,
            partitioner=partitioner,
            k=4
        )
        
        print("✅ Graph RAG retriever created")
        return retriever
        
    except Exception as e:
        print(f"❌ Graph RAG initialization failed: {e}")
        import traceback
        traceback.print_exc()
        return None

def test_retrieval():
    """Test document retrieval"""
    retriever = test_graph_rag_initialization()
    if not retriever:
        return False
    
    try:
        # Test query
        query = "quy định về điểm thi"
        print(f"\n🔍 Testing query: {query}")
        
        docs = retriever.get_relevant_documents(query)
        
        print(f"✅ Retrieved {len(docs)} documents")
        for i, doc in enumerate(docs):
            print(f"  Doc {i+1}: {doc.page_content[:100]}...")
            
        return True
        
    except Exception as e:
        print(f"❌ Retrieval test failed: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    print("🧪 Testing Graph RAG System")
    print("=" * 50)
    
    # Test imports
    if not test_graph_rag_imports():
        print("❌ Import test failed")
        sys.exit(1)
    
    print("\n🏗️ Testing initialization...")
    if not test_graph_rag_initialization():
        print("❌ Initialization test failed")
        sys.exit(1)
    
    print("\n🔍 Testing retrieval...")
    if not test_retrieval():
        print("❌ Retrieval test failed")
        sys.exit(1)
    
    print("\n🎉 All tests passed!")
    print("Graph RAG system is ready for evaluation")