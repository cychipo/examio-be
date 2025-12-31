import asyncio
import logging
from langchain_core.messages import BaseMessage

from supervisor_agent import ReActGraph

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

async def run_conversation_example():
    """
    Example of a multi-turn conversation with the agent using memory
    """
    # Create an instance of our agent
    agent = ReActGraph()
    
    # Initialize an empty conversation history
    conversation_history = []
    
    # First query
    logger.info("User: What's the average score of student 1?")
    first_query = "What's the average score of student 1?"
    
    # Process the first query
    conversation_history = await agent.chat_with_memory(conversation_history, first_query)
    
    # Log the agent's response
    logger.info(f"Agent: {conversation_history[-1].content}")
    
    # Second query (referencing the first query)
    logger.info("User: How does that compare to student 2?")
    second_query = "How does that compare to student 2?"
    
    # Process the second query with context from the first query
    conversation_history = await agent.chat_with_memory(conversation_history, second_query)
    
    # Log the agent's response
    logger.info(f"Agent: {conversation_history[-1].content}")
    
    # Third query (continuing the conversation)
    logger.info("User: Which student has the highest math score?")
    third_query = "Which student has the highest math score?"
    
    # Process the third query with full conversation context
    conversation_history = await agent.chat_with_memory(conversation_history, third_query)
    
    # Log the agent's response
    logger.info(f"Agent: {conversation_history[-1].content}")
    
    return conversation_history

if __name__ == "__main__":
    asyncio.run(run_conversation_example()) 