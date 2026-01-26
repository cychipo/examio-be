# OCR Service Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     examio-be Ecosystem                      │
│                                                              │
│  ┌────────────┐      ┌────────────┐      ┌────────────┐   │
│  │   Exam     │      │   Auth     │      │  Gateway   │   │
│  │  Service   │      │  Service   │      │  Service   │   │
│  └─────┬──────┘      └─────┬──────┘      └─────┬──────┘   │
│        │                   │                    │           │
│        │                   │                    │           │
│        └───────────────────┴────────────────────┘           │
│                            │                                │
│                            │ gRPC Call                      │
│                            ▼                                │
│                  ┌──────────────────┐                       │
│                  │  OCR Service     │                       │
│                  │  (NestJS gRPC)   │                       │
│                  │  Port: 50053     │                       │
│                  └────────┬─────────┘                       │
│                           │                                 │
│                           │ HTTP Request                    │
│                           │ (Internal)                      │
│                           ▼                                 │
│                  ┌──────────────────┐                       │
│                  │  Python Backend  │                       │
│                  │  (FastAPI)       │                       │
│                  │  Port: 8003      │                       │
│                  └────────┬─────────┘                       │
│                           │                                 │
└───────────────────────────┼─────────────────────────────────┘
                            │
                            │ Import & Execute
                            ▼
                  ┌──────────────────┐
                  │   olmocr Repo    │
                  │   (Local)        │
                  │   /examio/olmocr │
                  └──────────────────┘
```

## Data Flow

1. **Service gọi OCR**:
   ```typescript
   const result = await ocrService.processPdf({
     pdfData: Buffer,
     filename: "exam.pdf",
     userId: "user-123"
   })
   ```

2. **NestJS gRPC Controller** nhận request:
   - `apps/ocr-service/src/api/ocr.grpc.controller.ts`

3. **OCR Service** forward đến Python backend:
   - `apps/ocr-service/src/services/ocr.service.ts`
   - HTTP POST to `http://127.0.0.1:8003/api/ocr/process`

4. **Python FastAPI** nhận PDF:
   - `apps/ocr-service/src/backend/main.py`
   - Lưu PDF vào `uploads/`

5. **Gọi olmocr**:
   ```python
   subprocess.run([
     "python", "-m", "olmocr.pipeline",
     output_dir, "--pdfs", pdf_path, "--markdown"
   ])
   ```

6. **olmocr xử lý**:
   - Render PDF thành images
   - Chạy VLM OCR model
   - Output markdown vào `outputs/{job_id}/markdown/`

7. **Trả kết quả**:
   - Python backend đọc markdown
   - Trả về NestJS service qua HTTP
   - NestJS trả về caller qua gRPC

## File Flow

```
PDF Input
  ↓
uploads/{job_id}_filename.pdf
  ↓
olmocr processing
  ↓
outputs/{job_id}/markdown/filename.md
  ↓
Response: { jobId, content, pageCount }
```

## Proto Definition

```protobuf
service OcrService {
  rpc ProcessPdf (ProcessPdfRequest) returns (ProcessPdfResponse);
}

message ProcessPdfRequest {
  bytes pdf_data = 1;
  string filename = 2;
  optional string user_id = 3;
}

message ProcessPdfResponse {
  bool success = 1;
  string job_id = 2;
  string content = 3;        // Markdown content
  string error_message = 4;
  int32 page_count = 5;
}
```

## Environment Setup

```
OLMOCR_PATH=/Users/tobi/devs/examio/olmocr
```

Script tự động set PYTHONPATH:
```bash
PYTHONPATH=src:../../olmocr python -m src.backend.main
```

Điều này cho phép:
```python
import olmocr  # From /examio/olmocr
```
