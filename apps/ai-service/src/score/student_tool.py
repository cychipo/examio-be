from typing import Dict, List, Any, Optional
import json
from pydantic import BaseModel, Field

from langchain_core.tools import tool
from .database import Database


class StudentInfoInput(BaseModel):
    student_code: str = Field(description="The student code to get information for")


class GlobalDB:
    """A tool for retrieving student information from the database."""

    def __init__(self):
        self._db = None  # Lazy initialization

    @property
    def db(self):
        """Lazy load database connection"""
        if self._db is None:
            self._db = Database()
        return self._db

    async def connect(self):
        """Connect to the database"""
        await self.db.connect()

    async def close(self):
        """Close the database connection"""
        if self._db is not None:
            await self._db.close()


global_db = GlobalDB()

@tool("get_student_info", args_schema=StudentInfoInput)
async def get_student_info(student_code: str) -> str:
    """
    Get KMA student information from the database.
    Useful for retrieving information for a specific student.
    The student code must be provided.

    Args:
        student_code: The student code to get information for

    Returns:
        A JSON string containing the student information
    """
    try:
        # Get student
        student = await global_db.db.get_student(student_code)

        if not student:
            return json.dumps({"student": None, "message": f"No student found with code {student_code}"})

        # Convert to serializable format
        student_data = student.model_dump()

        return json.dumps({"student": student_data, "message": f"Found student information for {student_code}"})

    except Exception as e:
        return json.dumps({"student": None, "message": f"Error retrieving student information: {str(e)}"})
    finally:
        await global_db.close()
