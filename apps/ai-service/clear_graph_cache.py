"""
Utility script to clear GraphRAG cache.
Run this after rebuilding the document graph with build_graph.py
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src'))

from rag import clear_retriever_cache

if __name__ == "__main__":
    print("🗑️  Clearing GraphRAG cache...")
    clear_retriever_cache()
    print("✅ Cache cleared successfully!")
    print("ℹ️  Next query will reload the graph and recreate the cache.")
