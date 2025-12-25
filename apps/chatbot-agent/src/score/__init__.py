"""
Score package for KMA Agent.

This package provides tools for accessing and processing student score data.
"""

from .score_tool import get_student_scores
from .student_tool import get_student_info
from .calculator_tool import calculate_average_scores
from .database import Database
from .models import Student, Subject, Score, ScoreWithDetails, ScoreFilter, ScoreResponse

__version__ = "0.1.0"
__all__ = [
    "get_student_scores",
    "get_student_info",
    "calculate_average_scores",
    "Database",
    "Student", 
    "Subject", 
    "Score", 
    "ScoreWithDetails", 
    "ScoreFilter", 
    "ScoreResponse"
]
