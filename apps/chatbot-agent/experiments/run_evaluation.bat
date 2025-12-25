@echo off
echo =======================================
echo Installing RAGAS Evaluation Requirements
echo =======================================

REM Change to project directory
cd /d "d:\KMA_ChatBot_Frontend_System\chatbot_agent"

REM Install requirements
echo Installing RAGAS and dependencies...
pip install -r experiments\requirements_ragas.txt

REM Check if installation was successful
if %errorlevel% neq 0 (
    echo ERROR: Failed to install requirements
    pause
    exit /b 1
)

echo.
echo =======================================
echo Starting Chatbot Evaluation
echo =======================================

REM Run evaluation
python experiments\evaluate_chatbot.py

REM Check if evaluation was successful
if %errorlevel% neq 0 (
    echo ERROR: Evaluation failed
    pause
    exit /b 1
)

echo.
echo =======================================
echo Evaluation completed successfully!
echo =======================================

pause