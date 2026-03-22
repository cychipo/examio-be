import logging
import os
import sys
from datetime import datetime
from typing import List, Dict, Optional, Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, ConfigDict

# Add the parent directory to sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from src.rag.simple_chat_agent import SimpleChatAgent
from src.rag.retriever import create_in_memory_retriever
from src.backend.services.hybrid_retrieval_service import hybrid_retrieval_service
from src.llm.model_manager import ModelUnavailableError, model_manager

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
    model_type: Optional[str] = Field(
        default='qwen3_8b',
        alias="modelType",
        description='Model id tu registry'
    )
    system_prompt: Optional[str] = Field(
        default=None,
        alias="systemPrompt",
        description="Custom system prompt for the AI model"
    )

    model_config = ConfigDict(populate_by_name=True)

class ChatResponse(BaseModel):
    answer: str
    sources: List[Dict[str, Any]] = []
    timestamp: datetime = Field(default_factory=datetime.utcnow)


def _ensure_text(value: Any) -> str:
    return str(value)

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
        model_type = model_manager.resolve_model(request.model_type).id

        logger.info(f"Query AI: {query[:50]}... (RAG ID: {user_storage_id}, Model: {model_type})")

        retriever = None
        sources = []
        pre_context = None

        # 1. Setup RAG if ID provided
        if user_storage_id:
            retrieval_result = await hybrid_retrieval_service.retrieve_for_chat(
                user_storage_id=user_storage_id,
                query=query,
                model_type=model_type,
            )
            logger.info(
                "[AI_RETRIEVAL] mode=%s user_storage_id=%s selected=%s total=%s chat=query",
                retrieval_result.retrieval_mode,
                user_storage_id,
                retrieval_result.metadata.get("selected_chunks"),
                retrieval_result.metadata.get("total_chunks"),
            )
            pre_context = retrieval_result.combined_context
            sources = retrieval_result.sources

            if pre_context:
                retriever, _ = create_in_memory_retriever(pre_context)

        # 2. Use Agent to answer with specified model type
        # Note: In a stateless model, we pass history to the agent if supported,
        # or we prefix the query with context.
        agent = SimpleChatAgent(
            custom_retriever=retriever,
            model_type=model_type,
            pre_context=pre_context,
            system_prompt=None,
        )

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

    except ModelUnavailableError as e:
        raise HTTPException(status_code=503, detail={'code': e.code, 'message': str(e)})
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error in stateless query: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/stream")
async def stream_ai(request: ChatRequest):
    """
    Streaming AI Query Endpoint
    """
    try:
        query = request.query
        user_storage_id = request.user_storage_id
        model_type = model_manager.resolve_model(request.model_type).id

        # Log mode: with document or general chat
        if user_storage_id:
            logger.info(f"Stream AI [RAG mode]: query='{query[:50]}...', doc_id={user_storage_id}, model={model_type}")
        else:
            logger.info(f"Stream AI [General chat]: query='{query[:50]}...', model={model_type}")

        # Use PostgreSQL vector search instead of in-memory FAISS
        # This uses pre-computed embeddings from database (no re-embedding!)
        pre_context = None
        sources: List[Dict[str, Any]] = []
        if user_storage_id:
            retrieval_result = await hybrid_retrieval_service.retrieve_for_chat(
                user_storage_id=user_storage_id,
                query=query,
                model_type=model_type,
                top_k=8,
                max_content_length=8000,
            )
            logger.info(
                "[AI_RETRIEVAL] mode=%s user_storage_id=%s selected=%s total=%s chat=stream",
                retrieval_result.retrieval_mode,
                user_storage_id,
                retrieval_result.metadata.get("selected_chunks"),
                retrieval_result.metadata.get("total_chunks"),
            )
            pre_context = retrieval_result.combined_context
            sources = retrieval_result.sources
            logger.info(f"Retrieved {len(pre_context) if pre_context else 0} chars context from PostgreSQL")

        # Create agent with pre-fetched context (fast path - no retriever creation)
        agent = SimpleChatAgent(pre_context=pre_context, model_type=model_type, system_prompt=request.system_prompt)

        # History setup
        history_dicts: List[Dict[str, str]] = []
        if request.history:
            history_dicts = [
                {"role": m.role, "content": str(m.content)} for m in request.history
            ]

        def iter_response():
            import json
            full_answer: str = ""
            try:
                for chunk in agent.chat_stream(query, history=history_dicts):
                    chunk_text = _ensure_text(chunk)
                    full_answer += chunk_text
                    data = json.dumps({"type": "chunk", "data": chunk_text})
                    yield f"data: {data}\n\n"

                # Done event
                done_data = json.dumps({
                    "type": "done",
                    "data": {
                        "assistantMessage": {
                            "role": "assistant",
                            "content": full_answer,
                            "createdAt": datetime.now().isoformat()
                        },
                        "sources": sources,
                    }
                })
                yield f"data: {done_data}\n\n"

            except Exception as e:
                error_code = getattr(e, 'code', None)
                err_data = json.dumps({"type": "error", "data": str(e), "code": error_code})
                yield f"data: {err_data}\n\n"

        return StreamingResponse(iter_response(), media_type="text/event-stream")

    except ModelUnavailableError as e:
        raise HTTPException(status_code=503, detail={'code': e.code, 'message': str(e)})
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error in streaming query: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/health")
async def health_check():
    return {"status": "ok", "service": "ai-service-chat"}
