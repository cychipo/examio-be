#!/usr/bin/env python
"""
Test script for the Score Tool.

This script tests the functionality of the Score Tool, which is responsible
for retrieving student scores from the database.
"""

import os
import sys
import json
import asyncio
from pathlib import Path
from dotenv import load_dotenv

# Add parent directory to path to import modules
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)

# Import score tools directly
from score.score_tool import get_student_scores
from score.student_tool import get_student_info, global_db
from score.calculator_tool import calculate_average_scores
from score.database import Database

# Import RAG tool - will need to adjust import based on your project structure
try:
    from rag.tool import search_kma_regulations, create_rag_tool
    RAG_AVAILABLE = True
except ImportError:
    print("RAG module not available. Integration tests will be skipped.")
    RAG_AVAILABLE = False

# Load environment variables
load_dotenv()


async def test_database_connection():
    """Test database connection"""
    print("\n===== Testing Database Connection =====")
    
    try:
        # Connect to the database
        db = Database()
        await db.connect()
        print("Database connection successful!")
        
        # Close the connection
        await db.close()
        print("Database connection closed.")
    except Exception as e:
        print(f"Database connection failed: {str(e)}")


async def test_get_student_info():
    """Test retrieving student information"""
    print("\n===== Testing Student Info Tool =====")
    
    # Connect to the database
    await global_db.connect()
    
    # Test with a valid student code
    print("\nTesting with valid student code:")
    result = await get_student_info(student_code="CT123")
    print(f"Result: {result}")
    
    # Test with an invalid student code
    print("\nTesting with invalid student code:")
    result = await get_student_info(student_code="INVALID")
    print(f"Result: {result}")
    
    # Close the database connection
    await global_db.close()


async def test_get_student_scores():
    """Test retrieving student scores"""
    print("\n===== Testing Score Tool =====")
    
    # Connect to the database
    await global_db.connect()
    
    # Test with a valid student code
    print("\nTesting with valid student code:")
    result = await get_student_scores(student_code="CT123")
    print(f"Result: {result}")
    
    # Test with a semester filter
    print("\nTesting with semester filter:")
    result = await get_student_scores(student_code="CT123", semester="ki1-2023-2024")
    print(f"Result: {result}")
    
    # Test with a subject filter
    print("\nTesting with subject filter:")
    result = await get_student_scores(student_code="CT123", subject_id=1)
    print(f"Result: {result}")
    
    # Test with an invalid student code
    print("\nTesting with invalid student code:")
    result = await get_student_scores(student_code="INVALID")
    print(f"Result: {result}")
    
    # Close the database connection
    await global_db.close()


def test_score_calculator():
    """Test the score calculator"""
    print("\n===== Testing Score Calculator =====")
    
    # Create sample scores data
    scores_data = {
        "scores": [
            {
                "score_text": "A",
                "score_first": 8.5,
                "score_second": 9.0,
                "score_final": 8.0,
                "score_over_rall": 8.5,
                "semester": "ki1-2023-2024",
                "student_code": "CT123",
                "subject_id": 1
            },
            {
                "score_text": "B+",
                "score_first": 7.5,
                "score_second": 8.0,
                "score_final": 7.0,
                "score_over_rall": 7.5,
                "semester": "ki1-2023-2024",
                "student_code": "CT123",
                "subject_id": 2
            },
            {
                "score_text": "A-",
                "score_first": 8.0,
                "score_second": 8.5,
                "score_final": 9.0,
                "score_over_rall": 8.5,
                "semester": "ki2-2023-2024",
                "student_code": "CT123",
                "subject_id": 3
            }
        ]
    }
    
    # Convert to JSON string
    scores_json = json.dumps(scores_data)
    
    # Calculate averages
    result = calculate_average_scores(scores_json=scores_json)
    print(f"Result: {result}")


async def test_rag_integration():
    """Test integration with RAG tool"""
    if not RAG_AVAILABLE:
        print("\n===== Skipping RAG Integration Test (Module Not Available) =====")
        return
        
    print("\n===== Testing RAG Integration =====")
    
    # Connect to the database
    await global_db.connect()
    
    # Create sample regulation file if it doesn't exist
    project_root = Path(__file__).parent.parent.parent
    data_dir = os.path.join(project_root, "data")
    regulation_file = os.path.join(data_dir, "regulation.txt")
    
    if not os.path.exists(data_dir):
        os.makedirs(data_dir)
    
    if not os.path.exists(regulation_file):
        print("Creating sample regulation file...")
        with open(regulation_file, "w", encoding="utf-8") as f:
            f.write("Academic regulations at KMA:\n")
            f.write("1. Students must maintain a GPA of at least 2.0 to graduate.\n")
            f.write("2. All students must complete at least 120 credits to graduate.\n")
            f.write("3. To stay in good academic standing, students must maintain a 2.0 GPA each semester.\n")
            f.write("4. Students with a GPA below 2.0 for two consecutive semesters will be placed on academic probation.\n")
    
    try:
        # Initialize RAG tool
        create_rag_tool()
        
        # Get student scores
        scores_result = await get_student_scores(student_code="CT123")
        scores_data = json.loads(scores_result)
        
        # Calculate average
        average_result = calculate_average_scores(scores_json=scores_result)
        average_data = json.loads(average_result)
        
        # Get GPA requirement from regulations
        regulation_query = "What is the minimum GPA required to maintain good academic standing?"
        regulation_result = await search_kma_regulations(regulation_query)
        regulation_data = json.loads(regulation_result)
        
        print("\nTest Scenario: Checking if student meets academic requirements")
        print(f"Student GPA: {average_data.get('overall_average', {}).get('score_over_rall', 'Unknown')}")
        print(f"Requirement from regulations: {regulation_data.get('answer', 'Unknown')}")
        
        # Simple evaluation of whether student meets requirements
        student_gpa = average_data.get('overall_average', {}).get('score_over_rall', 0)
        if student_gpa >= 2.0:
            print("Result: Student is in good academic standing")
        else:
            print("Result: Student does not meet minimum GPA requirements")
        
    except Exception as e:
        print(f"Error testing RAG integration: {str(e)}")
    finally:
        # Close the database connection
        await global_db.close()


async def run_tests():
    """Run all tests"""
    print("Starting Score Tool Tests...")
    
    await test_database_connection()
    await test_get_student_info()
    await test_get_student_scores()
    test_score_calculator()
    await test_rag_integration()
    
    print("\nAll tests completed!")


if __name__ == "__main__":
    asyncio.run(run_tests()) 