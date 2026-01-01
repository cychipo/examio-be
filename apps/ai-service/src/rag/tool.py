"""
RAG (Retrieval Augmented Generation) tool for accessing all documents in KMA's knowledge base.

This tool allows querying information from all documents in the system, including KMA's regulations,
rules, policies, and any other uploaded documents in the data directory.
"""

import asyncio
import logging
from typing import Optional
from langchain_core.tools import tool
from pydantic import BaseModel, Field

from .rag_graph import process_kma_query_sync

logger = logging.getLogger(__name__)

class KMARegulationInput(BaseModel):
    query: str = Field(description="The query to search for in documents")
    department: Optional[str] = Field(default=None, description="Optional department filter: 'phongdaotao', 'phongkhaothi', 'khoa', 'viennghiencuuvahoptacphattrien', 'thongtinhvktmm', or None for smart auto-detection")


@tool("search_kma_regulations", args_schema=KMARegulationInput)
def search_kma_regulations(query: str, department: str = None, user_role: str = "student", user_department: str = None) -> str:
    """
    Search for information in KMA documents using department-specific graphs.
    Each department has its own document graph to avoid cross-contamination.
    Automatically detects relevant department from query if not specified.
    Departments: phongdaotao (training), phongkhaothi (testing/quality),
    khoa (faculties), viennghiencuuvahoptacphattrien (research), thongtinhvktmm (academy info).
    ALWAYS use this tool for regulation/policy questions.

    Args:
        query: Câu hỏi cần tìm kiếm
        department: Phòng ban cụ thể (optional, để semantic detection tự quyết định)
        user_role: Vai trò người dùng (student, admin, etc.)
        user_department: Phòng ban của người dùng

    Returns:
        Kết quả tìm kiếm với semantic routing
    """
    try:
        logger.info(f"🔍 search_kma_regulations called with query: {query[:100]}...")
        logger.info(f"📁 Department filter: {department}")
        logger.info(f"👤 User role: {user_role}, User department: {user_department}")

        # Prepare user metadata for semantic detection
        # Logic: If this is a department-specific API call (department param exists),
        # then user made a choice -> use that department
        # If user_department is explicitly None -> user chose "all" -> use common
        if user_department is None and department:
            # This is department-specific API call -> user chose this department
            user_dept_choice = department
        else:
            # Use explicit user_department (including empty string for "no choice")
            user_dept_choice = user_department or ''

        user_metadata = {
            'role': user_role or 'student',
            'department': user_dept_choice
        }

        # Call enhanced query processing
        # Pass department_filter when user explicitly chose a department
        effective_department_filter = department if user_dept_choice else None
        result = process_kma_query_sync(
            query=query,
            department_filter=effective_department_filter,
            user_metadata=user_metadata
        )

        # Extract answer from result
        if isinstance(result, dict):
            answer = result.get('answer', '')

            # Add department decision info if available
            if 'department_decision' in result and result['department_decision']:
                decision = result['department_decision']
                logger.info(f"🎯 Semantic routing: {decision.chosen_department} (confidence: {decision.confidence:.3f})")

                if decision.conflict_detected:
                    logger.info("⚠️ Semantic similarity resolved department conflict")

                # Optionally add metadata to answer
                if user_role == 'admin':  # Show debug info to admin
                    footer = f"\n\n---\n🤖 Semantic routing: {decision.chosen_department} | Confidence: {decision.confidence:.3f} | Conflicts: {decision.conflict_detected}"
                    answer += footer

            return answer
        else:
            return str(result)

    except Exception as e:
        logger.error(f"❌ Error in search_kma_regulations: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return f"Xin lỗi, đã xảy ra lỗi khi tìm kiếm thông tin: {str(e)}"

    try:
        logger.info(f"🔍 search_kma_regulations called with query: {query[:100]}...")
        logger.info(f"📁 Department filter: {department}")

        # Use the improved process_kma_query_sync function with department filter
        result = process_kma_query_sync(query, department_filter=department)

        answer = result.get('answer', '')
        logger.info(f"✅ RAG query completed, answer length: {len(answer)}")
        logger.info(f"📝 Answer preview: {answer[:200]}...")

        if not answer or len(answer.strip()) == 0:
            logger.error("❌ Empty answer returned from RAG!")
            return "Xin lỗi, tôi không tìm thấy thông tin phù hợp với câu hỏi của bạn."

        return answer

    except Exception as e:
        import traceback
        error_details = traceback.format_exc()
        logger.error(f"❌ Error in search_kma_regulations: {error_details}")
        return f"Xin lỗi, đã xảy ra lỗi khi tìm kiếm thông tin: {str(e)}"


def create_rag_tool():
    """Create a configured instance of the RAG tool."""
    return search_kma_regulations
