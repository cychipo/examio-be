"""
GeminiClient - Multi-key/Model Rotation cho Gemini API.
Port từ NestJS ai.service.ts sang Python.

Features:
- Multi-key rotation: Xoay vòng nhiều API keys khi hết quota
- Multi-model rotation: Xoay vòng models khi một model fail
- Retry với exponential backoff cho 429/503 errors
"""

import os
import time
import random
import asyncio
from typing import Optional, List, Set, Dict, Any, Callable, TypeVar
from dotenv import load_dotenv
import google.generativeai as genai
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.language_models import BaseChatModel

load_dotenv()

T = TypeVar('T')


class GeminiClient:
    """
    Gemini API Client với multi-key/model rotation.

    Cấu hình qua environment variables:
    - GEMINI_API_KEYS: Danh sách API keys, phân cách bởi dấu phẩy
    - GEMINI_MODEL_NAMES: Danh sách models, phân cách bởi dấu phẩy
    """

    _instance = None

    # Singleton pattern
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(GeminiClient, cls).__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return

        # Load API keys từ environment
        keys_str = os.getenv("GEMINI_API_KEYS", os.getenv("GOOGLE_API_KEY", ""))
        self.api_keys: List[str] = [k.strip() for k in keys_str.split(",") if k.strip()]

        # Load model names từ environment
        models_str = os.getenv("GEMINI_MODEL_NAMES", "gemini-2.0-flash")
        self.model_names: List[str] = [m.strip() for m in models_str.split(",") if m.strip()]

        # State tracking
        self.current_key_index: int = 0
        self.current_model_index: int = 0
        self.failed_keys: Set[str] = set()
        self.failed_models_per_key: Dict[str, Set[str]] = {}

        # Reset times (60 seconds)
        self.key_reset_time: float = time.time() + 60
        self.model_reset_time: float = time.time() + 60

        # Configure default genai
        if self.api_keys:
            genai.configure(api_key=self.api_keys[0])

        self._initialized = True
        print(f"🔧 GeminiClient initialized: {len(self.api_keys)} keys, {len(self.model_names)} models")

    def get_next_key(self) -> str:
        """Lấy API key tiếp theo, bỏ qua các keys đã failed."""
        if not self.api_keys:
            raise ValueError("Không có API keys được cấu hình. Set GEMINI_API_KEYS hoặc GOOGLE_API_KEY.")

        # Reset failed keys nếu hết thời gian
        if time.time() > self.key_reset_time:
            print("🔄 Reset danh sách failed keys...")
            self.failed_keys.clear()
            self.key_reset_time = time.time() + 60

        # Lọc keys available
        available_keys = [k for k in self.api_keys if k not in self.failed_keys]

        if not available_keys:
            raise ValueError("Tất cả API keys đều đã hết quota. Vui lòng chờ hoặc thêm keys mới.")

        # Xoay vòng
        key_index = self.current_key_index % len(available_keys)
        selected_key = available_keys[key_index]
        self.current_key_index = (self.current_key_index + 1) % len(available_keys)

        print(f"🔑 Sử dụng API key {key_index + 1}/{len(available_keys)} (masked: {selected_key[:8]}...)")
        return selected_key

    def get_next_model(self) -> str:
        """Lấy model tiếp theo, bỏ qua các models đã failed cho key hiện tại."""
        if not self.model_names:
            return "gemini-2.0-flash"

        # Reset failed models nếu hết thời gian
        if time.time() > self.model_reset_time:
            print("🔄 Reset danh sách failed models...")
            self.failed_models_per_key.clear()
            self.model_reset_time = time.time() + 60

        # Lấy current key
        current_key = self.api_keys[self.current_key_index % len(self.api_keys)] if self.api_keys else "default"
        failed_models = self.failed_models_per_key.get(current_key, set())

        # Lọc models available
        available_models = [m for m in self.model_names if m not in failed_models]

        if not available_models:
            # Reset và dùng model đầu tiên
            self.current_model_index = 0
            return self.model_names[0]

        # Xoay vòng
        model_index = self.current_model_index % len(available_models)
        selected_model = available_models[model_index]

        print(f"🤖 Sử dụng model {model_index + 1}/{len(available_models)}: {selected_model}")
        return selected_model

    def mark_key_failed(self, api_key: str):
        """Đánh dấu API key đã hết quota."""
        self.failed_keys.add(api_key)
        print(f"❌ Đánh dấu API key failed. Tổng failed: {len(self.failed_keys)}/{len(self.api_keys)}")

    def mark_model_failed(self, model: str) -> bool:
        """
        Đánh dấu model failed cho key hiện tại.
        Returns True nếu tất cả models đều failed (cần rotate key).
        """
        current_key = self.api_keys[max(0, self.current_key_index - 1)] if self.api_keys else "default"

        if current_key not in self.failed_models_per_key:
            self.failed_models_per_key[current_key] = set()

        self.failed_models_per_key[current_key].add(model)
        failed_count = len(self.failed_models_per_key[current_key])

        print(f"❌ Đánh dấu model '{model}' failed. Tổng: {failed_count}/{len(self.model_names)}")

        # Nếu tất cả models đều failed, báo hiệu cần rotate key
        if failed_count >= len(self.model_names):
            print("⚠️ Tất cả models đều fail cho key hiện tại, chuyển sang key tiếp theo...")
            self.current_model_index = 0
            return True

        # Rotate sang model tiếp theo
        self.current_model_index = (self.current_model_index + 1) % len(self.model_names)
        return False

    async def retry_with_backoff(
        self,
        fn: Callable[[], T],
        max_retries: int = 5,
        initial_delay: float = 1.0
    ) -> T:
        """
        Thực thi function với retry và exponential backoff.
        Tự động handle 429 (rate limit) và 503 (unavailable).
        """
        last_error = None

        for attempt in range(1, max_retries + 1):
            try:
                # Nếu là coroutine
                result = fn()
                if asyncio.iscoroutine(result):
                    return await result
                return result

            except Exception as e:
                last_error = e
                error_str = str(e).lower()

                # Check lỗi 429 (rate limit / quota exceeded)
                is_429 = "429" in error_str or "quota" in error_str or "rate" in error_str

                # Check lỗi 503 (unavailable)
                is_503 = "503" in error_str or "unavailable" in error_str

                if is_429:
                    # Model & Key Rotation Strategy
                    try:
                        # 1. First try to mark current model as failed
                        current_model = self.model_names[self.current_model_index % len(self.model_names)] if self.model_names else "default"
                        should_rotate_key = self.mark_model_failed(current_model)

                        if should_rotate_key:
                            # 2. If all models failed for this key -> Rotate Key
                            current_key = self.api_keys[max(0, self.current_key_index - 1)]
                            self.mark_key_failed(current_key)

                            # Reconfigure genai with new key
                            new_key = self.get_next_key()
                            genai.configure(api_key=new_key)
                    except Exception as rot_e:
                        print(f"Rotation logic error: {rot_e}")
                        # Fallback: force key rotation if uncertain
                        try:
                            self.get_next_key()
                        except: pass

                    # Delay trước khi retry
                    jitter = random.uniform(0, 0.3)
                    delay = initial_delay * (1.5 ** (attempt - 1)) + jitter
                    print(f"⏳ 429 error, retry sau {delay:.2f}s (attempt {attempt}/{max_retries})")

                    if attempt < max_retries:
                        await asyncio.sleep(delay)
                        continue

                elif is_503:
                    # Transient error, retry với backoff nhưng không mark key failed
                    jitter = random.uniform(0, 0.3)
                    delay = initial_delay * (1.6 ** (attempt - 1)) + jitter
                    print(f"⏳ 503 error, retry sau {delay:.2f}s (attempt {attempt}/{max_retries})")

                    if attempt < max_retries:
                        await asyncio.sleep(delay)
                        continue

                else:
                    # Non-retryable error
                    raise e

        raise last_error

    def get_chat_model(self, temperature: float = 0.7) -> BaseChatModel:
        """
        Tạo LangChain ChatGoogleGenerativeAI instance với key/model rotation.
        """
        api_key = self.get_next_key()
        model_name = self.get_next_model()

        return ChatGoogleGenerativeAI(
            model=model_name,
            temperature=temperature,
            google_api_key=api_key,
            max_retries=2,
        )

    def get_generative_model(self):
        """Tạo google.generativeai.GenerativeModel với rotation."""
        api_key = self.get_next_key()
        model_name = self.get_next_model()

        genai.configure(api_key=api_key)
        return genai.GenerativeModel(model_name)

    async def generate_content(self, prompt: str) -> str:
        """Generate content với retry và rotation."""
        async def _generate():
            model = self.get_generative_model()
            response = model.generate_content(prompt)
            return response.text

        return await self.retry_with_backoff(_generate)

    async def create_embedding(self, text: str, task_type: str = "retrieval_document") -> List[float]:
        """
        Tạo embedding vector với key rotation và retry.

        Hỗ trợ các embedding models:
        - models/embedding-001 (768 dims)
        - models/text-embedding-004 (768 dims)

        Args:
            text: Text cần tạo embedding
            task_type: Loại task - "retrieval_document" hoặc "retrieval_query"

        Returns:
            List[float] embedding vector
        """
        # Embedding models để xoay vòng khi bị rate limit
        embedding_models = [
            "models/text-embedding-004",  # Mới hơn, performance tốt hơn
            "models/embedding-001",        # Legacy nhưng ổn định
        ]

        last_error = None

        for model_idx, embed_model in enumerate(embedding_models):
            async def _embed():
                api_key = self.get_next_key()
                genai.configure(api_key=api_key)

                result = genai.embed_content(
                    model=embed_model,
                    content=text,
                    task_type=task_type
                )
                return result['embedding']

            try:
                return await self.retry_with_backoff(_embed, max_retries=3)
            except Exception as e:
                last_error = e
                error_str = str(e).lower()

                # Nếu là lỗi rate limit/quota, thử model tiếp theo
                if "429" in error_str or "quota" in error_str or "rate" in error_str:
                    print(f"⚠️ Embedding model {embed_model} bị rate limit, thử model tiếp theo...")
                    continue
                else:
                    # Lỗi khác thì raise ngay
                    raise e

        # Đã thử tất cả models mà vẫn fail
        raise last_error or Exception("Tất cả embedding models đều fail")

    async def create_embeddings_batch(
        self,
        texts: List[str],
        task_type: str = "retrieval_document",
        batch_size: int = 5,
        delay_between_batches: float = 0.5
    ) -> List[List[float]]:
        """
        Tạo embeddings cho nhiều texts với batching để tránh rate limit.

        Args:
            texts: List các texts cần embedding
            task_type: Loại task
            batch_size: Số texts mỗi batch
            delay_between_batches: Delay giữa các batch (giây)

        Returns:
            List các embedding vectors
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
                    print(f"⚠️ Error embedding text {i+j}: {emb}")
                    # Retry single text
                    try:
                        emb = await self.create_embedding(batch[j], task_type)
                    except Exception as e:
                        raise Exception(f"Failed to embed text {i+j}: {e}")
                embeddings.append(emb)

            # Delay between batches to avoid rate limit
            if i + batch_size < len(texts):
                await asyncio.sleep(delay_between_batches)

        return embeddings


# Singleton instance
gemini_client = GeminiClient()
