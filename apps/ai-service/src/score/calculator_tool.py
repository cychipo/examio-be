import json
import re
from langchain_core.tools import tool
from pydantic import BaseModel, Field


class ScoreCalculatorInput(BaseModel):
    scores_json: str = Field(description="JSON string OR raw text containing scores data")


def parse_scores_to_json(raw_text: str) -> dict:
    """Parse raw text format 'Tên môn (x tín chỉ): điểm' thành dict JSON"""
    scores_list = []
    pattern = r"(.+?)\s*\((\d+)\s*tín chỉ\)\s*:\s*([\d\.]+)"
    for match in re.findall(pattern, raw_text):
        subject_name = match[0].strip()
        subject_credits = int(match[1])
        score_over_rall = float(match[2])
        scores_list.append({
            "subject_name": subject_name,
            "subject_credits": subject_credits,
            "score_over_rall": score_over_rall
        })
    return {"scores": scores_list}


@tool("calculate_average_scores", args_schema=ScoreCalculatorInput,
      description=("Calculate average scores (GPA) from provided scores data. "
                   "Input can be a JSON string with field 'scores' or raw text in format 'Tên môn (x tín chỉ): điểm'"))
def calculate_average_scores(scores_json: str) -> str:
    """
    Calculate average scores from provided scores data.
    Args:
        scores_json: JSON string OR raw text containing scores data
    Returns:
        JSON string containing GPA and total credits
    """
    try:
        # Nếu là JSON
        try:
            data = json.loads(scores_json)
        except json.JSONDecodeError:
            # Nếu không phải JSON → parse từ text
            data = parse_scores_to_json(scores_json)

        if "scores" not in data or not data["scores"]:
            return json.dumps({"averages": {}, "message": "No scores data provided"})

        scores = data["scores"]

        total_weighted_score = sum(s["score_over_rall"] * s["subject_credits"] for s in scores)
        total_credits = sum(s["subject_credits"] for s in scores)

        if total_credits == 0:
            return json.dumps({"averages": {}, "message": "Total credits is zero, cannot calculate average"})

        average_score = round(total_weighted_score / total_credits, 2)

        return json.dumps({
            "averages": {"average_score": average_score, "total_credits": total_credits},
            "message": "Average scores calculated successfully"
        }, ensure_ascii=False)

    except Exception as e:
        return json.dumps({"averages": {}, "message": f"Error calculating averages: {str(e)}"})
