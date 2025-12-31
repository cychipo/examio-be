import asyncio
import pandas as pd
from bert_score import score as bert_score
from sentence_transformers import SentenceTransformer, util as st_util
from tqdm import tqdm
import logging
from langchain_core.messages import AIMessage
from agent.supervisor_agent import ReActGraph

# Logging setup
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load sentence transformer model
semantic_model = SentenceTransformer("paraphrase-multilingual-MiniLM-L12-v2")

# Đánh giá bằng BERTScore và Semantic Similarity
def evaluate_response(pred: str, expected: str, f1_threshold=0.75, cos_threshold=0.8):
    # BERTScore
    P, R, F1 = bert_score([pred], [expected], lang="vi")  # Hoặc lang="en" nếu dùng tiếng Anh
    precision = P[0].item()
    recall = R[0].item()
    f1 = F1[0].item()

    # Semantic cosine similarity
    emb1 = semantic_model.encode(pred, convert_to_tensor=True)
    emb2 = semantic_model.encode(expected, convert_to_tensor=True)
    cos_sim = st_util.cos_sim(emb1, emb2).item()

    # Match nếu F1 hoặc Cosine đạt ngưỡng
    is_match = (f1 >= f1_threshold) or (cos_sim >= cos_threshold)

    return {
        "precision": precision,
        "recall": recall,
        "f1_score": f1,
        "cosine_similarity": cos_sim,
        "match": is_match
    }

# Hàm chính đánh giá chatbot
async def evaluate_chatbot_async(dataset_path: str, f1_threshold=0.75, cos_threshold=0.80):
    df = pd.read_csv(dataset_path)
    total = len(df)
    correct = 0
    total_latency = 0.0
    detailed_results = []

    agent = ReActGraph()
    agent.create_graph()

    for _, row in tqdm(df.iterrows(), total=total, desc="Evaluating"):
        query = str(row["query"])
        expected = str(row["expected_answer"])

        try:
            import time
            start = time.time()
            result = await agent.chat_with_memory([], query)
            end = time.time()
            latency = end - start
            total_latency += latency

            # Lấy predicted
            last_msg = result[-1]
            predicted = last_msg.content.strip() if isinstance(last_msg, AIMessage) else ""

            metrics = evaluate_response(predicted, expected, f1_threshold, cos_threshold)

            if metrics["match"]:
                correct += 1

            detailed_results.append({
                "query": query,
                "expected": expected,
                "predicted": predicted,
                "precision": round(metrics["precision"], 4),
                "recall": round(metrics["recall"], 4),
                "f1_score": round(metrics["f1_score"], 4),
                "cosine_similarity": round(metrics["cosine_similarity"], 4),
                "latency_sec": round(latency, 2),
                "match": metrics["match"]
            })

        except Exception as e:
            logger.error(f"Error on query '{query}': {e}")
            detailed_results.append({
                "query": query,
                "expected": expected,
                "predicted": "ERROR",
                "precision": 0.0,
                "recall": 0.0,
                "f1_score": 0.0,
                "cosine_similarity": 0.0,
                "latency_sec": 0.0,
                "match": False
            })

    # Tính trung bình
    accuracy = correct / total
    avg_latency = total_latency / total
    avg_precision = sum(r["precision"] for r in detailed_results) / total
    avg_recall = sum(r["recall"] for r in detailed_results) / total
    avg_f1 = sum(r["f1_score"] for r in detailed_results) / total
    avg_cos_sim = sum(r["cosine_similarity"] for r in detailed_results) / total

    # In kết quả tổng thể
    print(f"\n🎯 Accuracy (match=True): {accuracy:.2%}")
    print(f"📌 Avg Precision: {avg_precision:.4f}")
    print(f"📌 Avg Recall:    {avg_recall:.4f}")
    print(f"📌 Avg F1-score:  {avg_f1:.4f}")
    print(f"📌 Avg CosSim:    {avg_cos_sim:.4f}")
    print(f"⏱️  Avg Latency:  {avg_latency:.2f} seconds")

    # Ghi kết quả chi tiết
    pd.DataFrame(detailed_results).to_csv("evaluation_result.csv", index=False)
    print("📄 Saved results to evaluation_result.csv")

# Chạy chương trình
if __name__ == "__main__":
    import os
    import nest_asyncio
    nest_asyncio.apply()

    dataset_file = os.path.join(os.path.dirname(__file__), "test_dataset.csv")
    asyncio.run(evaluate_chatbot_async(dataset_file, f1_threshold=0.75, cos_threshold=0.80))
