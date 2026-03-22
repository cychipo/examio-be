"""
Ollama Embeddings Client - Local embedding service using Ollama.

Features:
- Local embeddings using Ollama nomic-embed-text model
- No external API calls needed
- Works fully offline
"""

import os
import math
import asyncio
import time
from typing import List, Optional
import httpx
from dotenv import load_dotenv

import logging
load_dotenv()

logger = logging.getLogger(__name__)

DEFAULT_OLLAMA_EMBED_MAX_LENGTH = 2000
DEFAULT_OLLAMA_EMBED_BATCH_SIZE = 5
DEFAULT_OLLAMA_EMBED_MAX_CONCURRENCY = 5
DEFAULT_OLLAMA_EMBED_DELAY_BETWEEN_BATCHES = 0.02


def _get_int_env(name: str, default: int, min_value: int = 1) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = int(raw)
        return max(min_value, value)
    except ValueError:
        logger.warning(f"Invalid {name}={raw!r}, using default={default}")
        return default


def _get_float_env(name: str, default: float, min_value: float = 0.0) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = float(raw)
        return max(min_value, value)
    except ValueError:
        logger.warning(f"Invalid {name}={raw!r}, using default={default}")
        return default


def get_embedding_text_limit() -> int:
    return _get_int_env("OLLAMA_EMBED_MAX_LENGTH", DEFAULT_OLLAMA_EMBED_MAX_LENGTH)


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
        self.verify_ssl = os.getenv("OLLAMA_VERIFY_SSL", "true").lower() == "true"
        self.timeout = httpx.Timeout(120.0, connect=30.0)
        self.embed_max_length = get_embedding_text_limit()
        self.default_batch_size = _get_int_env("OLLAMA_EMBED_BATCH_SIZE", DEFAULT_OLLAMA_EMBED_BATCH_SIZE)
        self.max_concurrency = _get_int_env("OLLAMA_EMBED_MAX_CONCURRENCY", DEFAULT_OLLAMA_EMBED_MAX_CONCURRENCY)
        self.default_delay_between_batches = _get_float_env(
            "OLLAMA_EMBED_DELAY_BETWEEN_BATCHES",
            DEFAULT_OLLAMA_EMBED_DELAY_BETWEEN_BATCHES,
        )
        self._client: Optional[httpx.AsyncClient] = None
        self._initialized = True
        logger.info(
            "OllamaEmbeddings initialized: "
            f"base_url={self.base_url}, "
            f"model={self.model}, "
            f"max_length={self.embed_max_length}, "
            f"batch_size={self.default_batch_size}, "
            f"max_concurrency={self.max_concurrency}, "
            f"delay_between_batches={self.default_delay_between_batches}"
        )

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=self.timeout,
                verify=self.verify_ssl,
                trust_env=False
            )
        return self._client

    async def close(self):
        if self._client and not self._client.is_closed:
            await self._client.aclose()

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
            max_length = self.embed_max_length
            if len(text) > max_length:
                logger.warning(f"Truncating text from {len(text)} to {max_length} chars for embedding")
                text = text[:max_length]

            logger.debug(f"Embedding text ({len(text)} chars) to {self.base_url}/api/embeddings with model {self.model}")

            client = await self._get_client()
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
                except Exception:
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
        batch_size: Optional[int] = None,
        delay_between_batches: Optional[float] = None
    ) -> List[List[float]]:
        """
        Create embeddings for multiple texts.

        Args:
            texts: List of texts to embed
            task_type: Ignored for Ollama
            batch_size: Number of texts per batch (None = read from env/default)
            delay_between_batches: Delay between batches in seconds (None = read from env/default)

        Returns:
            List of embedding vectors
        """
        if not texts:
            return []

        resolved_batch_size = max(1, batch_size or self.default_batch_size)
        resolved_delay_between_batches = max(0.0, delay_between_batches if delay_between_batches is not None else self.default_delay_between_batches)
        resolved_max_concurrency = max(1, self.max_concurrency)
        semaphore = asyncio.Semaphore(resolved_max_concurrency)

        async def _embed_with_limit(input_text: str) -> List[float]:
            async with semaphore:
                return await self.create_embedding(input_text, task_type)

        total_batches = math.ceil(len(texts) / resolved_batch_size)
        start_time = time.perf_counter()
        embeddings: List[List[float]] = []

        for i in range(0, len(texts), resolved_batch_size):
            batch = texts[i:i + resolved_batch_size]

            # Process batch concurrently (bounded by semaphore)
            batch_embeddings = await asyncio.gather(
                *[_embed_with_limit(text) for text in batch],
                return_exceptions=True
            )

            # Check for errors and keep existing retry behavior per-item
            for j, emb in enumerate(batch_embeddings):
                if isinstance(emb, Exception):
                    logger.warning(f"Error embedding text {i + j}: {emb}")
                    try:
                        emb = await _embed_with_limit(batch[j])
                    except Exception as e:
                        raise Exception(f"Failed to embed text {i + j}: {e}")
                embeddings.append(emb)

            # Delay between batches (if configured)
            if i + resolved_batch_size < len(texts) and resolved_delay_between_batches > 0:
                await asyncio.sleep(resolved_delay_between_batches)

        elapsed_ms = int((time.perf_counter() - start_time) * 1000)
        logger.info(
            f"[AI_TIMING] stage=embedding_batch texts={len(texts)} batches={total_batches} "
            f"batch_size={resolved_batch_size} max_concurrency={resolved_max_concurrency} elapsed_ms={elapsed_ms}"
        )
        return embeddings


# Singleton instance
ollama_embeddings = OllamaEmbeddings()
