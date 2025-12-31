from pydantic import BaseModel, Field, validator
from typing import Optional, List, Dict, Any
import re


class Subject(BaseModel):
    subject_id: int
    subject_name: str
    subject_credits: Optional[int] = None


class Student(BaseModel):
    student_code: str
    student_name: str
    student_class: Optional[str] = None


class Score(BaseModel):
    score_text: Optional[str] = None
    score_first: Optional[float] = None
    score_second: Optional[float] = None
    score_final: Optional[float] = None
    score_over_rall: Optional[float] = None
    semester: Optional[str] = None
    student_code: str
    subject_id: int


class ScoreWithDetails(Score):
    subject: Subject
    student: Student


class ScoreFilter(BaseModel):
    student_code: Optional[str] = None
    semester: Optional[str] = None
    subject_id: Optional[int] = None
    
    @validator('semester')
    def validate_semester_format(cls, value):
        if value is None:
            return value
        
        pattern = r'^(ki|k)[1-4]-\d{4}-\d{4}$'
        if not re.match(pattern, value):
            raise ValueError(
                "Semester must be in format ki1_2024_2025, k2_2024_2025, etc."
            )
        return value

    
class ScoreResponse(BaseModel):
    scores: List[ScoreWithDetails] = Field(default_factory=list)
    message: str = "Scores retrieved successfully" 