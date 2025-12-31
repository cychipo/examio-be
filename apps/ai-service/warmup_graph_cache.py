"""
Warm up GraphRAG cache on server startup.
This preloads the graph, partitioner, and retriever into memory.
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src'))

from rag import get_retriever

if __name__ == "__main__":
    print("🔥 Warming up GraphRAG cache...")
    print("=" * 60)
    
    try:
        retriever = get_retriever()
        print("=" * 60)
        print("✅ GraphRAG cache warmed up successfully!")
        print("💡 Subsequent queries will be much faster (~4-5s instead of ~12s)")
        print("\nCache status:")
        print(f"  - Graph: ✅ Loaded")
        print(f"  - Partitioner: ✅ Loaded")
        print(f"  - Retriever: ✅ Ready")
        
    except FileNotFoundError as e:
        print("=" * 60)
        print("❌ Graph file not found!")
        print(f"   {e}")
        print("\n💡 Please run: python build_graph.py")
        sys.exit(1)
        
    except Exception as e:
        print("=" * 60)
        print(f"❌ Error warming up cache: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
