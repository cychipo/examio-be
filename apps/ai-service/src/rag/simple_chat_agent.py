import logging
import os
from pathlib import Path
from typing import Dict, Any, List

from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from llm import get_llm, LLMConfig
from rag.retriever import create_enhanced_hybrid_retriever, smart_retrieve, get_metadata_config, MetadataEnhancedHybridRetriever

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


class SimpleChatAgent:
    """Simplified chat agent without LangGraph to avoid recursion issues"""

    def __init__(self, custom_retriever=None, model_name: str = None):
        """Initialize the Simple Chat Agent"""
        try:
            self.llm = get_llm()
            logger.info(f"Initialized LLM with runtime model selection")
        except Exception as e:
            logger.error(f"Failed to initialize LLM: {e}")
            raise

        # Store the retriever - allow None for general chat without documents
        if custom_retriever is not None:
            self.retriever = custom_retriever
        else:
            try:
                self.retriever = self.get_default_retriever()
            except Exception as e:
                logger.warning(f"No default retriever available: {e}. Will use LLM only for general chat.")
                self.retriever = None

        # Load prompts
        self.prompts = self._load_prompts()

    def get_default_retriever(self):
        """Get the default hybrid retriever for KMA regulations"""
        current_dir = Path(__file__).parent.absolute()
        project_root = current_dir.parent.parent
        vector_db_path = os.path.join(project_root, "vector_db")
        data_dir = os.path.join(project_root, "data")

        # Check if paths exist before creating retriever
        if not os.path.exists(vector_db_path) or not os.path.exists(data_dir):
            raise FileNotFoundError(f"Vector DB or data directory not found")

        # Use enhanced hybrid retriever with sliding window
        config = get_metadata_config()
        chunk_settings = config.get_chunk_settings()
        window_size = chunk_settings.get('sliding_window_size', 2)

        enhanced_retriever, _ = create_enhanced_hybrid_retriever(
            vector_db_path=vector_db_path,
            data_dir=data_dir,
            window_size=window_size
        )
        return enhanced_retriever

    def _load_prompts(self):
        """Load prompts from files"""
        prompts = {}
        prompts_dir = os.path.join(os.path.dirname(__file__), "prompts")

        try:
            with open(os.path.join(prompts_dir, "detailed_generate.txt"), "r", encoding="utf-8") as f:
                prompts["generate"] = f.read().strip()
                logger.info("Loaded detailed generate prompt")
        except FileNotFoundError:
            try:
                with open(os.path.join(prompts_dir, "generate.txt"), "r", encoding="utf-8") as f:
                    prompts["generate"] = f.read().strip()
                    logger.info("Loaded standard generate prompt")
            except FileNotFoundError:
                prompts["generate"] = """Bạn là một trợ lý AI thông minh chuyên phân tích và trả lời câu hỏi dựa trên nội dung tài liệu.

Nhiệm vụ: Hãy phân tích kỹ thông tin được cung cấp và đưa ra câu trả lời chi tiết, đầy đủ và hữu ích.

Câu hỏi: {question}

Thông tin từ tài liệu:
{context}

Yêu cầu trả lời:
1. Trả lời trực tiếp câu hỏi với thông tin cụ thể từ tài liệu
2. Cung cấp chi tiết và ví dụ nếu có trong tài liệu
3. Nếu có nhiều thông tin liên quan, hãy tổ chức thành các điểm rõ ràng
4. Nếu thông tin không đầy đủ để trả lời, hãy nêu rõ những gì có thể trả lời được
5. Sử dụng ngôn ngữ rõ ràng, dễ hiểu và tự nhiên

Trả lời chi tiết:"""
                logger.info("Using fallback detailed prompt")

        return prompts

    def check_relevance(self, query: str) -> bool:
        """Check if query requires document context"""
        if not self.retriever:
            return False

        prompt = f"""You are a smart assistant. The user has uploaded documents for context.
Query: "{query}"

Does this query require looking up information in the uploaded documents?
- Greeting (hello, hi, xin chào): NO
- Identity questions (who are you, bạn là ai): NO
- General knowledge questions (what is AI, 1+1=?): NO (unless explicitly asking 'according to the document')
- Specific questions about content (summarize this, what does it say about X, tóm tắt tài liệu): YES

Answer only YES or NO."""

        try:
             response = self.llm.invoke([HumanMessage(content=prompt)])
             content = response.content.strip().upper()
             logger.info(f"Relevance check for '{query}': {content}")
             return "YES" in content
        except Exception as e:
            logger.error(f"Relevance check failed: {e}")
            return True

    def chat_stream(self, message: str, history: List[Dict[str, str]] = None):
        """Process a chat message and yield response chunks with history, dynamic RAG, and retry rotation"""
        from llm.gemini_client import GeminiClient
        import time

        def stream_with_retry(messages):
            max_retries = 15
            for attempt in range(max_retries):
                try:
                    for chunk in self.llm.stream(messages):
                        yield chunk.content
                    return
                except Exception as e:
                    error_msg = str(e)
                    is_quota = "429" in error_msg or "quota" in error_msg.lower() or "ResourceExhausted" in error_msg

                    if is_quota and attempt < max_retries - 1:
                        logger.warning(f"Quota exceeded (Attempt {attempt+1}/{max_retries}), rotating model/key...")
                        try:
                            client = GeminiClient()
                            current_model = getattr(self.llm, 'model', None) or getattr(self.llm, 'model_name', "gemini-2.0-flash")

                            should_rotate_key = client.mark_model_failed(current_model)

                            if should_rotate_key:
                                if hasattr(self.llm, 'google_api_key'):
                                    key = self.llm.google_api_key.get_secret_value()
                                    client.mark_key_failed(key)

                            self.llm = get_llm()
                            time.sleep(1)
                            continue
                        except Exception as rot_err:
                            logger.error(f"Rotation error: {rot_err}")
                            pass

                    if attempt == max_retries - 1 or not is_quota:
                        logger.error(f"Streaming failed: {e}")
                        yield f"Error: {e}"
                        return

        try:
            logger.info(f"Processing streaming query: {message}")
            if history is None:
                history = []

            # 1. Convert history
            lc_messages = []
            lc_messages.append(SystemMessage(content="Bạn là Sensei, một trợ lý AI thông minh hỗ trợ học tập. Hãy trả lời thân thiện, chính xác và hữu ích."))

            for msg in history:
                role = msg.get('role')
                content = msg.get('content')
                if role == 'user':
                    lc_messages.append(HumanMessage(content=content))
                elif role == 'assistant':
                    lc_messages.append(AIMessage(content=content))

            # 2. Check relevance
            use_rag = False
            if self.retriever:
                use_rag = self.check_relevance(message)

            # 3. NO RAG
            if not use_rag:
                logger.info("Query not relevant to docs (or no docs), using general chat")
                lc_messages.append(HumanMessage(content=message))
                yield from stream_with_retry(lc_messages)
                return

            # 4. RAG
            logger.info("Query relevant to docs, retrieving context...")
            if isinstance(self.retriever, MetadataEnhancedHybridRetriever):
                docs = smart_retrieve(self.retriever, message, use_smart_filtering=True)
            else:
                docs = self.retriever.get_relevant_documents(message)

            context_docs = docs[:8]
            context = "\n\n---\n\n".join([
                f"Đoạn {i+1}:\n{doc.page_content}"
                for i, doc in enumerate(context_docs)
            ])

            if context.strip():
                enhanced_prompt = f"""Bạn là một trợ lý AI chuyên nghiệp. Hãy trả lời câu hỏi dựa trên thông tin được cung cấp dưới đây.

🎯 Câu hỏi: {message}

📚 Thông tin từ tài liệu:
{context}

📝 Hướng dẫn:
• Trả lời chi tiết và chính xác dựa trên tài liệu
• Nếu tài liệu không chứa thông tin, hãy nói rõ
• Dẫn chứng từ các đoạn (ví dụ: theo Đoạn 1...)
"""
            else:
                enhanced_prompt = f"""Xin lỗi, tôi không tìm thấy thông tin liên quan trong tài liệu cho câu hỏi: "{message}".
Tôi sẽ trả lời dựa trên kiến thức chung: {message}"""

            lc_messages.append(HumanMessage(content=enhanced_prompt))

            yield from stream_with_retry(lc_messages)

            if context.strip() and len(context_docs) > 0:
                yield f"\n\n📋 *Thông tin từ {len(context_docs)} đoạn trích dẫn.*"

        except Exception as e:
            logger.error(f"Error in chat streaming: {str(e)}")
            yield f"Error: {str(e)}"

    def chat(self, message: str) -> str:
        """Process a chat message and return detailed response"""
        try:
            logger.info(f"Processing query: {message}")

            # If no retriever (general chat without documents), use LLM directly
            if self.retriever is None:
                logger.info("No retriever - using LLM directly for general chat")
                response = self.llm.invoke([{"role": "user", "content": message}])
                return response.content

            # Retrieve relevant documents using smart retrieval with sliding window
            if isinstance(self.retriever, MetadataEnhancedHybridRetriever):
                docs = smart_retrieve(self.retriever, message, use_smart_filtering=True)
            else:
                docs = self.retriever.get_relevant_documents(message)

            # Use more context for detailed answers
            context_docs = docs[:8]  # Increase from 5 to 8 for more context
            context = "\n\n---\n\n".join([
                f"Đoạn {i+1}:\n{doc.page_content}"
                for i, doc in enumerate(context_docs)
            ])

            # Enhanced prompt for detailed responses
            if context.strip():
                # Add context about the query type for better responses
                enhanced_prompt = f"""Bạn là một trợ lý AI chuyên nghiệp, hãy phân tích kỹ câu hỏi và thông tin được cung cấp để đưa ra câu trả lời toàn diện.

🎯 Câu hỏi cần trả lời: {message}

📚 Thông tin từ tài liệu (được chia thành các đoạn):
{context}

📝 Hướng dẫn trả lời:
• Đọc kỹ tất cả các đoạn thông tin được cung cấp
• Tổng hợp và phân tích để đưa ra câu trả lời đầy đủ nhất
• Sắp xếp thông tin theo logic, chia thành các phần rõ ràng
• Cung cấp ví dụ cụ thể từ tài liệu nếu có
• Sử dụng bullet points hoặc số thứ tự khi phù hợp
• Nếu có nhiều khía cạnh, hãy trình bày từng khía cạnh một cách có hệ thống

💬 Câu trả lời chi tiết:"""
            else:
                enhanced_prompt = f"""Xin lỗi, tôi không tìm thấy thông tin liên quan trong tài liệu đã upload để trả lời câu hỏi: "{message}"

Vui lòng thử:
• Đặt câu hỏi khác liên quan đến nội dung tài liệu
• Sử dụng từ khóa khác có thể có trong tài liệu
• Kiểm tra lại xem tài liệu có chứa thông tin bạn đang tìm không

Tôi sẽ cố gắng trả lời dựa trên kiến thức tổng quát: {message}"""

            response = self.llm.invoke([{"role": "user", "content": enhanced_prompt}])

            # Post-process response to add more details if needed
            answer = response.content

            # Add source information at the end
            if context.strip() and len(context_docs) > 0:
                answer += f"\n\n📋 *Thông tin được tổng hợp từ {len(context_docs)} đoạn liên quan trong tài liệu.*"

            logger.info("Detailed response generated successfully")
            return answer

        except Exception as e:
            logger.error(f"Error in chat processing: {str(e)}")
            return f"❌ Xin lỗi, đã xảy ra lỗi khi xử lý câu hỏi: {str(e)}\n\nVui lòng thử lại hoặc đặt câu hỏi khác."


async def process_simple_query(query: str, retriever=None, llm=None) -> Dict[str, Any]:
    """Simple query processing function without LangGraph"""
    try:
        # Create agent
        agent = SimpleChatAgent(custom_retriever=retriever)

        # Process query
        answer = agent.chat(query)

        # Get sources using smart retrieval
        if isinstance(agent.retriever, MetadataEnhancedHybridRetriever):
            docs = smart_retrieve(agent.retriever, query, use_smart_filtering=True)
        else:
            docs = agent.retriever.get_relevant_documents(query)
        sources = [doc.page_content for doc in docs[:3]]

        return {
            "answer": answer,
            "sources": sources,
            "source_type": "simple_agent"
        }

    except Exception as e:
        logger.error(f"Error in simple query processing: {str(e)}")
        return {
            "answer": f"Lỗi xử lý câu hỏi: {str(e)}",
            "sources": [],
            "source_type": "error"
        }
