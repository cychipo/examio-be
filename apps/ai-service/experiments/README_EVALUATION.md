# Chatbot Evaluation with RAGAS

Đánh giá hiệu năng chatbot sử dụng các độ đo RAGAS với rate limiting 10 câu/phút.

## 📋 Tổng Quan

Script này đánh giá chatbot dựa trên dataset 358 câu hỏi-đáp án tiếng Việt với các độ đo:
- **Answer Correctness**: Độ chính xác của câu trả lời
- **Faithfulness**: Độ trung thực với context
- **Context Relevance**: Độ liên quan của context
- **Answer Relevance**: Độ liên quan của câu trả lời

## 🚀 Cách Sử Dụng

### 0. Chuẩn Bị
Đảm bảo có GOOGLE_API_KEY trong file `.env`:
```bash
GOOGLE_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.0-flash
```

### 1. Chạy Tự Động
```bash
cd d:\KMA_ChatBot_Frontend_System\chatbot_agent\experiments
run_evaluation.bat
```

### 2. Chạy Thủ Công
```bash
# Cài đặt dependencies
pip install -r requirements_ragas.txt

# Chạy đánh giá
python evaluate_chatbot.py
```

## 📁 Cấu Trúc File

```
experiments/
├── evaluate_chatbot.py          # Script đánh giá chính
├── requirements_ragas.txt       # Dependencies
├── evaluation_config.json       # Cấu hình
├── run_evaluation.bat          # Script chạy tự động
├── dataset chatbot update.csv  # Dataset đánh giá
└── evaluation_results/         # Kết quả đánh giá
    ├── evaluation_results_[timestamp].csv
    └── evaluation_metrics_[timestamp].json
```

## ⚙️ Cấu Hình

### Rate Limiting
- **10 câu hỏi/phút** (6 giây giữa các request)
- Tránh rate limit của API/model

### Dataset
- **358 câu hỏi** tiếng Việt
- Format: `question,answer_expected`
- Xử lý encoding tự động (UTF-8, Latin-1, CP1252)

### Evaluation Modes
1. **Gemini LLM + RAG** (mặc định): Sử dụng Gemini API với RAG system
2. **API Mode**: Gọi API endpoint

## 📊 Kết Quả

### CSV Results
Chứa chi tiết từng câu hỏi:
- `question`: Câu hỏi
- `answer`: Câu trả lời từ chatbot
- `ground_truth`: Đáp án mong đợi
- `contexts`: Context sử dụng
- `response_time`: Thời gian phản hồi

### JSON Metrics
Tóm tắt điểm số RAGAS:
```json
{
  "answer_correctness": 0.8234,
  "faithfulness": 0.7891,
  "context_relevance": 0.8567,
  "answer_relevance": 0.8012
}
```

## 🔧 Tùy Chỉnh

### Giới Hạn Số Câu Hỏi
```python
max_questions = 50  # Đánh giá chỉ 50 câu đầu
max_questions = None  # Đánh giá tất cả (mặc định)
```

### Thay Đổi Rate Limit
```python
rate_limit_delay = 3  # 3 giây (20 câu/phút)
rate_limit_delay = 6  # 6 giây (10 câu/phút - mặc định)
```

### Chọn Metrics
```python
metrics = [
    answer_correctness,    # Độ chính xác
    faithfulness,          # Độ trung thực
    context_relevance,     # Liên quan context
    answer_relevance       # Liên quan câu trả lời
]
```

## 🛠️ Troubleshooting

### Lỗi Import RAGAS
```bash
pip install --upgrade ragas datasets langchain openai
```

### Lỗi Encoding Dataset
Script tự động thử các encoding:
- UTF-8 (ưu tiên)
- Latin-1
- CP1252
- ISO-8859-1

### Lỗi Local Agent
Script tự động chuyển sang API mode nếu Gemini LLM lỗi.

### Memory Issues
Giảm số câu hỏi đánh giá:
```python
max_questions = 100  # Thay vì None
```

## 📈 Hiểu Kết Quả

### Score Range: 0.0 - 1.0
- **0.8-1.0**: Excellent
- **0.6-0.8**: Good  
- **0.4-0.6**: Fair
- **0.2-0.4**: Poor
- **0.0-0.2**: Very Poor

### Ý Nghĩa Metrics
- **Answer Correctness**: So sánh với ground truth
- **Faithfulness**: Không ảo tưởng, dựa vào context
- **Context Relevance**: Context có liên quan đến câu hỏi
- **Answer Relevance**: Câu trả lời có trả lời đúng câu hỏi

## 📝 Logs

Script hiển thị tiến trình real-time:
```
🔄 Evaluating 358 questions...
📝 Question 1/358: Quy định về đăng ký học...
✅ Response: Theo quy định của trường...
⏱️ Waiting 6 seconds...
📊 Computing RAGAS metrics...
💾 Results saved to: evaluation_results_20241203_143022.csv
```

## ⚠️ Lưu Ý

1. **API Keys**: Cần GOOGLE_API_KEY trong .env cho Gemini LLM
2. **Rate Limiting**: Đánh giá 358 câu mất ~36 phút
3. **Memory**: Dataset lớn có thể cần nhiều RAM
4. **Network**: Cần kết nối internet cho Gemini API và RAGAS models