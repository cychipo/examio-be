from typing import Dict, List, Any, Optional, TypedDict, Annotated, Sequence

from langchain_core.messages import BaseMessage
from langgraph.graph import add_messages
from pydantic import BaseModel, Field


# --- Định nghĩa State ---
class MyAgentState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], add_messages]
    department: Optional[str]  # Add department to state
