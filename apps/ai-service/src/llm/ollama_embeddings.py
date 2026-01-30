"""
Ollama Embeddings Client - Local embedding service using Ollama.

Features:
- Local embeddings using Ollama nomic-embed-text model
- No external API calls needed
- Works fully offline
"""

import os
import asyncio
from typing import List
import httpx
from dotenv import load_dotenv

import logging
load_dotenv()

logger = logging.getLogger(__name__)


class OllamaEmbeddings:
    """
    Ollama Embeddings Client for local embedding generation.
    
    Uses nomic-embed-text model by default (768 dimensions, same as Gemini).
    """
    
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(OllamaEmbeddings, cls).__new__(cls)
            cls._instance._initialized = False
        return cls._instance
    
    def __init__(self):
        if self._initialized:
            return
        
        self.base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip('/')
        self.model = os.getenv("OLLAMA_EMBEDDING_MODEL", "nomic-embed-text:latest")
        self._initialized = True
        logger.info(f"OllamaEmbeddings initialized: {self.base_url}, model: {self.model}")
    
    async def create_embedding(self, text: str, task_type: str = "retrieval_document") -> List[float]:
        """
        Create embedding vector using Ollama.
        
        Args:
            text: Text to embed
            task_type: Ignored for Ollama (kept for API compatibility)
        
        Returns:
            List[float] embedding vector
        """
        try:
            verify_ssl = os.getenv("OLLAMA_VERIFY_SSL", "true").lower() == "true"
            # Use trust_env=False to bypass system proxies
            async with httpx.AsyncClient(timeout=60.0, verify=verify_ssl, trust_env=False) as client:
                response = await client.post(
                    f"{self.base_url}/api/embeddings",
                    json={
                        "model": self.model,
                        "prompt": text
                    }
                )
                response.raise_for_status()
                data = response.json()
                return data.get("embedding", [])
        except Exception as e:
            logger.error(f"Ollama embedding error: {e}")
            raise Exception(f"Ollama embedding failed: {e}")
    
    async def create_embeddings_batch(
        self,
        texts: List[str],
        task_type: str = "retrieval_document",
        batch_size: int = 5,
        delay_between_batches: float = 0.1
    ) -> List[List[float]]:
        """
        Create embeddings for multiple texts.
        
        Args:
            texts: List of texts to embed
            task_type: Ignored for Ollama
            batch_size: Number of texts per batch
            delay_between_batches: Delay between batches (seconds)
        
        Returns:
            List of embedding vectors
        """
        embeddings = []
        
        for i in range(0, len(texts), batch_size):
            batch = texts[i:i + batch_size]
            
            # Process batch concurrently
            batch_embeddings = await asyncio.gather(
                *[self.create_embedding(text, task_type) for text in batch],
                return_exceptions=True
            )
            
            # Check for errors
            for j, emb in enumerate(batch_embeddings):
                if isinstance(emb, Exception):
                    logger.warning(f"Error embedding text {i+j}: {emb}")
                    # Retry single text
                    try:
                        emb = await self.create_embedding(batch[j], task_type)
                    except Exception as e:
                        raise Exception(f"Failed to embed text {i+j}: {e}")
                embeddings.append(emb)
            
            # Small delay between batches
            if i + batch_size < len(texts):
                await asyncio.sleep(delay_between_batches)
        
        return embeddings


# Singleton instance
ollama_embeddings = OllamaEmbeddings()
