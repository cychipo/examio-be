from agent.supervisor_agent import ReActGraph
import asyncio

async def main():
    graph = ReActGraph()
    # Test với "Hi."
    response = await graph.chat("Hi.")
    print(response[-1].content)
    # Test với công cụ
    response = await graph.chat("Tính điểm trung bình của sinh viên ID 123")
    print(response[-1].content)

asyncio.run(main())