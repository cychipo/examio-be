"""
KMA Regulations Assistant - A chatbot for answering questions about 
regulations at the Academy of Cryptographic Techniques (KMA).
"""

from .tool import create_rag_tool, search_kma_regulations
from .rag_graph import process_kma_query, process_kma_query_sync, get_retriever, clear_retriever_cache
from .table_aware_chunking import load_documents_from_folder

__version__ = "0.2.1"  # GraphRAG with caching
__all__ = [
    "create_rag_tool",
    "search_kma_regulations",
    "process_kma_query",
    "process_kma_query_sync",
    "get_retriever",
    "clear_retriever_cache",
    "load_documents_from_folder"
]
