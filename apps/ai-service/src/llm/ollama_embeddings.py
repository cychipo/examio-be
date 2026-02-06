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
            text: Text to embed (will be truncated if too long)
            task_type: Ignored for Ollama (kept for API compatibility)
        
        Returns:
            List[float] embedding vector
        """
        try:
            # Truncate text if too long (nomic-embed-text has ~2048 token context window)
            # ~4 chars per token, so max ~2000 chars to be safe
            max_length = 2000
            if len(text) > max_length:
                logger.warning(f"Truncating text from {len(text)} to {max_length} chars for embedding")
                text = text[:max_length]
            
            verify_ssl = os.getenv("OLLAMA_VERIFY_SSL", "true").lower() == "true"
            
            # Increase timeout for large texts
            timeout = httpx.Timeout(120.0, connect=30.0)
            
            logger.debug(f"Embedding text ({len(text)} chars) to {self.base_url}/api/embeddings with model {self.model}")
            
            async with httpx.AsyncClient(timeout=timeout, verify=verify_ssl, trust_env=False) as client:
                response = await client.post(
                    f"{self.base_url}/api/embeddings",
                    json={
                        "model": self.model,
                        "prompt": text
                    }
                )
                
                if response.status_code != 200:
                    # Log response body for debugging
                    try:
                        error_body = response.text
                        logger.error(f"Ollama error response: {error_body[:500]}")
                    except:
                        pass
                
                response.raise_for_status()
                data = response.json()
                embedding = data.get("embedding", [])
                logger.debug(f"Got embedding with {len(embedding)} dimensions")
                return embedding
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
