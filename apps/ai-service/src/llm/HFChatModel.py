from typing import List, Optional, Any
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import BaseMessage, AIMessage, HumanMessage, SystemMessage
from langchain_core.outputs import ChatResult, ChatGeneration
from huggingface_hub import InferenceClient
from pydantic import Field
import os
from .model_manager import model_manager

class HuggingFaceChatModel(BaseChatModel):
    """LangChain wrapper for Hugging Face InferenceClient."""
    
    client: InferenceClient = Field(default=None, exclude=True)
    model: str = Field(default="NousResearch/Hermes-2-Pro-Llama-3-8B")
    temperature: float = Field(default=0.7)
    max_tokens: int = Field(default=512)
    
    def __init__(self, model_path: str = None, **kwargs):
        # Lấy cấu hình từ model_manager nếu không có model_path được chỉ định
        if model_path is None:
            model_path = model_manager.get_model_path()
            kwargs.setdefault("temperature", model_manager.get_temperature())
            kwargs.setdefault("max_tokens", model_manager.get_max_tokens())
        
        super().__init__(model=model_path, **kwargs)
        self.model = model_path
        self.client = InferenceClient(
            provider="novita",
            api_key=os.environ.get("HF_TOKEN"),
            model=model_path
        )
    
    def _generate(self, messages: List[BaseMessage], stop: Optional[List[str]] = None, **kwargs) -> ChatResult:
        hf_messages = []
        
        # Thêm system prompt vào đầu nếu chưa có
        if not any(isinstance(msg, SystemMessage) for msg in messages):
            system_prompt = model_manager.get_system_prompt()
            hf_messages.append({"role": "system", "content": system_prompt})
        
        for msg in messages:
            role = "assistant" if isinstance(msg, AIMessage) else "user" if isinstance(msg, HumanMessage) else "system"
            hf_messages.append({"role": role, "content": msg.content})
        
        try:
            completion = self.client.chat.completions.create(
                model=self.model,
                messages=hf_messages,
                temperature=self.temperature,
                max_tokens=self.max_tokens,
                **kwargs
            )
            ai_message = AIMessage(content=completion.choices[0].message.content)
            generation = ChatGeneration(message=ai_message)
            return ChatResult(generations=[generation])
        except Exception as e:
            raise ValueError(f"Error invoking Hugging Face model: {str(e)}")
    
    async def _agenerate(self, messages: List[BaseMessage], stop: Optional[List[str]] = None, **kwargs) -> ChatResult:
        return self._generate(messages, stop, **kwargs)
    
    def bind_tools(self, tools: List[Any]) -> "HuggingFaceChatModel":
        self._tools = tools
        return self
    
    @property
    def _llm_type(self) -> str:
        return "huggingface_inference"

async def get_mistral_llm(model_name: str = "NousResearch/Hermes-2-Pro-Llama-3-8B") -> BaseChatModel:
    return HuggingFaceChatModel(model=model_name)