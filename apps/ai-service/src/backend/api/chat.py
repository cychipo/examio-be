import logging
import os
import sys
from datetime import datetime
from typing import List, Dict, Optional, Any

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

# Add the parent directory to sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from rag.simple_chat_agent import SimpleChatAgent
from rag.retriever import create_in_memory_retriever
from backend.services.ocr_service import ocr_service
from rag.vector_store_pg import get_pg_vector_store

logger = logging.getLogger(__name__)

router = APIRouter()

# ==================== Request Models ====================

class Message(BaseModel):
    role: str = Field(..., description="user or assistant")
    content: str = Field(..., description="Message content")

class ChatRequest(BaseModel):
    query: str = Field(..., description="Current user question")
    history: List[Message] = Field(default=[], description="Previous conversation history")
    user_storage_id: Optional[str] = Field(None, description="ID for RAG context from a specific file")
    department: Optional[str] = Field(None, description="Department context for general RAG")

class ChatResponse(BaseModel):
    answer: str
    sources: List[Dict[str, Any]] = []
    timestamp: datetime = Field(default_factory=datetime.utcnow)

# ==================== Helper Functions ====================

def format_history_for_langchain(history: List[Message]):
    """Convert simple message list to LangChain format if needed"""
    from langchain_core.messages import HumanMessage, AIMessage
    lc_history = []
    for msg in history:
        if msg.role.lower() == "user":
            lc_history.append(HumanMessage(content=msg.content))
        else:
            lc_history.append(AIMessage(content=msg.content))
    return lc_history

# ==================== API Endpoints ====================

@router.post("/query", response_model=ChatResponse)
async def query_ai(request: ChatRequest):
    """
    Stateless AI Query Endpoint

    Flow:
    1. If user_storage_id is provided, use it for RAG context from PostgreSQL.
    2. Otherwise, use general RAG or just LLM.
    3. Generate response using SimpleChatAgent.
    """
    try:
        query = request.query
        user_storage_id = request.user_storage_id

        logger.info(f"Query AI: {query[:50]}... (RAG ID: {user_storage_id})")

        retriever = None
        sources = []

        # 1. Setup RAG if ID provided
        if user_storage_id:
            chunks = await ocr_service.get_document_chunks(user_storage_id)
            if chunks:
                combined_content = "\n\n".join([c.content for c in chunks])
                retriever, _ = create_in_memory_retriever(combined_content)

                # Get sources for display
                pg_store = get_pg_vector_store()
                similar_docs = await pg_store.search_similar([user_storage_id], query, top_k=3)
                sources = [{"content": doc.content[:300], "page": doc.page_range} for doc in similar_docs]

        # 2. Use Agent to answer
        # Note: In a stateless model, we pass history to the agent if supported,
        # or we prefix the query with context.
        agent = SimpleChatAgent(custom_retriever=retriever)

        # If we have history, we should ideally use it.
        # For SimpleChatAgent, we might need to modify it to accept history or just use a generic LangChain chain.
        # For now, we'll prefix the query if history exists for simplicity,
        # but a "senior" way is to use a ChatBuffer.

        # Simple implementation of history inclusion
        full_query = query
        if request.history:
            history_text = "\n".join([f"{m.role}: {m.content}" for m in request.history[-5:]]) # Last 5 turns
            full_query = f"Conversation history:\n{history_text}\n\nUser: {query}"

        answer = agent.chat(full_query)

        return ChatResponse(
            answer=answer,
            sources=sources
        )

    except Exception as e:
        logger.error(f"Error in stateless query: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/health")
async def health_check():
    return {"status": "ok", "service": "ai-stateless-node"}
