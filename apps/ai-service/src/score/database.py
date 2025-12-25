import os
from typing import List, Optional, Dict, Any
import asyncpg
from dotenv import load_dotenv

from .models import Score, Student, Subject, ScoreWithDetails, ScoreFilter

load_dotenv()

class Database:
    def __init__(self):
        self.connection_pool = None
        self._dsn = os.getenv("POSTGRES_URI")
        # self._dsn = os.getenv("POSTGRES_URI_DOCKER")
        if not self._dsn:
            raise ValueError("POSTGRES_URI environment variable is not set")

    async def connect(self):
        """Connect to the PostgreSQL database"""
        if self.connection_pool is None:
            self.connection_pool = await asyncpg.create_pool(dsn=self._dsn)
        return self.connection_pool

    async def close(self):
        """Close all database connections"""
        if self.connection_pool:
            await self.connection_pool.close()
            self.connection_pool = None

    async def get_student(self, student_code: str) -> Optional[Student]:
        """Get student information by student code"""
        pool = await self.connect()
        async with pool.acquire() as conn:
            student_record = await conn.fetchrow(
                """
                SELECT * FROM students WHERE student_code = $1
                """,
                student_code
            )
            if not student_record:
                return None
            return Student(**dict(student_record))

    async def get_subject(self, subject_id: int) -> Optional[Subject]:
        """Get subject information by subject ID"""
        pool = await self.connect()
        async with pool.acquire() as conn:
            subject_record = await conn.fetchrow(
                """
                SELECT * FROM subjects WHERE subject_id = $1
                """,
                subject_id
            )
            if not subject_record:
                return None
            return Subject(**dict(subject_record))

    async def get_scores(self, filter: ScoreFilter) -> List[ScoreWithDetails]:
        """Get scores with filter options"""
        pool = await self.connect()
        async with pool.acquire() as conn:
            # Build dynamic query based on filters
            query = """
            SELECT s.*, st.student_name, st.student_class, 
                  su.subject_name, su.subject_credits
            FROM scores s
            JOIN students st ON s.student_code = st.student_code
            JOIN subjects su ON s.subject_id = su.subject_id
            WHERE 1=1
            """
            params = []
            param_index = 1

            if filter.student_code:
                query += f" AND s.student_code = ${param_index}"
                params.append(filter.student_code)
                param_index += 1

            if filter.semester:
                query += f" AND s.semester = ${param_index}"
                params.append(filter.semester)
                param_index += 1

            if filter.subject_id:
                query += f" AND s.subject_id = ${param_index}"
                params.append(filter.subject_id)
                param_index += 1

            query += " ORDER BY s.semester DESC, su.subject_name"

            # Execute query
            score_records = await conn.fetch(query, *params)
            
            # Process results
            results = []
            for record in score_records:
                record_dict = dict(record)
                
                # Build Student object
                student = Student(
                    student_code=record_dict["student_code"],
                    student_name=record_dict["student_name"],
                    student_class=record_dict["student_class"]
                )
                
                # Build Subject object
                subject = Subject(
                    subject_id=record_dict["subject_id"],
                    subject_name=record_dict["subject_name"],
                    subject_credits=record_dict["subject_credits"]
                )
                
                # Build Score object
                score = Score(
                    score_text=record_dict["score_text"],
                    score_first=record_dict["score_first"],
                    score_second=record_dict["score_second"],
                    score_final=record_dict["score_final"],
                    score_over_rall=record_dict["score_over_rall"],
                    semester=record_dict["semester"],
                    student_code=record_dict["student_code"],
                    subject_id=record_dict["subject_id"]
                )
                
                # Combine into ScoreWithDetails
                score_with_details = ScoreWithDetails(
                    **score.model_dump(),
                    student=student,
                    subject=subject
                )
                
                results.append(score_with_details)
                
            return results 