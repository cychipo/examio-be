# OCR Service

OCR microservice cho Examio sử dụng olmocr (AllenAI). Service này xử lý PDF và trả về markdown content thông qua gRPC.

## Kiến trúc

Service này bao gồm 2 phần:

1. **NestJS gRPC Service** (TypeScript)
   - Nhận request qua gRPC từ các service khác
   - Forward request đến Python backend
   - Port: 50053 (gRPC)

2. **Python FastAPI Backend**
   - Xử lý OCR thực tế sử dụng olmocr
   - Port: 8003 (HTTP internal)

## Cài đặt

### 1. Cài đặt olmocr

Có 2 cách để sử dụng olmocr:

#### Option A: Sử dụng olmocr từ repo có sẵn (Khuyến nghị cho dev)

Nếu bạn đã clone olmocr vào `/Users/tobi/devs/examio/olmocr`:

```bash
# Tạo .env file
cd apps/ocr-service
cp .env.example .env

# Thêm vào .env:
echo "OLMOCR_PATH=/Users/tobi/devs/examio/olmocr" >> .env

# Cài dependencies của olmocr (nếu chưa)
cd ../../olmocr
pip install -e .[gpu] --extra-index-url https://download.pytorch.org/whl/cu128
```

#### Option B: Cài olmocr vào venv riêng

```bash
cd apps/ocr-service

# Tạo virtual environment
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# Cài olmocr với GPU support
pip install olmocr[gpu] --extra-index-url https://download.pytorch.org/whl/cu128

# Cài dependencies của service
pip install -r requirements.txt
```

**Yêu cầu hệ thống:**
- Python 3.11+
- NVIDIA GPU với ít nhất 12GB VRAM
- CUDA toolkit (cho olmocr)

### 2. Cấu hình Environment

```bash
cp .env.example .env
```

Chỉnh sửa `.env`:

**Nếu dùng Option A (olmocr từ repo):**
```env
GRPC_PORT=50053
OCR_PYTHON_SERVICE_URL=http://127.0.0.1:8003/api/ocr
PORT=8003
OLMOCR_PATH=/Users/tobi/devs/examio/olmocr
```

**Nếu dùng Option B (olmocr trong venv):**
```env
GRPC_PORT=50053
OCR_PYTHON_SERVICE_URL=http://127.0.0.1:8003/api/ocr
PORT=8003
# Không cần OLMOCR_PATH
```

## Chạy Service

### Cách 1: Sử dụng pnpm scripts (Khuyến nghị)

Terminal 1 - Python backend:
```bash
# Script này tự động set OLMOCR_PATH và PYTHONPATH
pnpm dev:ocr-python
```

Terminal 2 - NestJS gRPC service:
```bash
pnpm dev:ocr
```

### Cách 2: Chạy thủ công

**Nếu dùng olmocr từ repo (Option A):**
```bash
cd apps/ocr-service
PYTHONPATH=src:../../olmocr OLMOCR_PATH=../../olmocr python -m src.backend.main
```

**Nếu dùng olmocr trong venv (Option B):**
```bash
cd apps/ocr-service
source venv/bin/activate
PYTHONPATH=src python -m src.backend.main
```

**NestJS service:**
```bash
nest start ocr-service --watch
```

## Sử dụng từ các service khác

### File Requirements

**ONLY PDF files are accepted:**
- File extension must be `.pdf`
- MIME type must be `application/pdf` or `application/x-pdf`
- File must have valid PDF signature (`%PDF` magic number)

**No file size limits** - Can handle PDFs of any size (limited only by timeout and resources)

### 1. Import proto trong service của bạn

```typescript
import { ClientGrpc, Transport } from '@nestjs/microservices';
import { join } from 'path';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: 'OCR_SERVICE',
        transport: Transport.GRPC,
        options: {
          package: 'ocr',
          protoPath: join(__dirname, '../../../libs/common/src/protos/ocr.proto'),
          url: '127.0.0.1:50053',
        },
      },
    ]),
  ],
})
export class YourModule {}
```

### 2. Inject client và sử dụng

```typescript
import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';

interface OcrService {
  processPdf(data: {
    pdfData: Buffer;
    filename: string;
    userId?: string;
  }): Promise<{
    success: boolean;
    jobId: string;
    content: string;
    errorMessage: string;
    pageCount: number;
  }>;
}

@Injectable()
export class YourService implements OnModuleInit {
  private ocrService: OcrService;

  constructor(@Inject('OCR_SERVICE') private client: ClientGrpc) {}

  onModuleInit() {
    this.ocrService = this.client.getService<OcrService>('OcrService');
  }

  async processDocument(pdfBuffer: Buffer, filename: string) {
    const result = await this.ocrService.processPdf({
      pdfData: pdfBuffer,
      filename: filename,
      userId: 'user-123',
    });

    if (result.success) {
      console.log(`OCR completed: ${result.jobId}`);
      console.log(`Content: ${result.content}`);
      console.log(`Pages: ${result.pageCount}`);
    } else {
      console.error(`OCR failed: ${result.errorMessage}`);
    }

    return result;
  }
}
```

## Cấu trúc thư mục

```
apps/ocr-service/
├── src/
│   ├── api/
│   │   └── ocr.grpc.controller.ts   # gRPC controller
│   ├── backend/
│   │   ├── __init__.py
│   │   └── main.py                   # Python FastAPI service
│   ├── services/
│   │   └── ocr.service.ts            # Service gọi Python backend
│   ├── ocr-service.module.ts
│   └── main.ts
├── uploads/                          # Temp PDF files
├── outputs/                          # OCR results
├── requirements.txt                  # Python dependencies
├── tsconfig.app.json
├── .env.example
└── README.md
```

## Proto Definition

File: `libs/common/src/protos/ocr.proto`

```protobuf
service OcrService {
    rpc ProcessPdf (ProcessPdfRequest) returns (ProcessPdfResponse);
    rpc HealthCheck (HealthCheckRequest) returns (HealthCheckResponse);
}

message ProcessPdfRequest {
    bytes pdf_data = 1;
    string filename = 2;
    optional string user_id = 3;
}

message ProcessPdfResponse {
    bool success = 1;
    string job_id = 2;
    string content = 3;
    string error_message = 4;
    int32 page_count = 5;
}
```

## API Endpoints (Internal)

### Python Backend HTTP API

**POST /api/ocr/process**
- Content-Type: `multipart/form-data`
- Fields:
  - `file`: PDF file
  - `user_id`: (optional) User ID

Response:
```json
{
  "success": true,
  "job_id": "uuid",
  "content": "markdown content...",
  "page_count": 10,
  "error_message": ""
}
```

**GET /health**
```json
{
  "healthy": true,
  "message": "OCR service is running",
  "version": "1.0.0"
}
```

## Troubleshooting

### Python service không khởi động

1. Kiểm tra olmocr đã cài đúng:
```bash
python -c "import olmocr; print(olmocr.__version__)"
```

2. Kiểm tra GPU:
```bash
nvidia-smi
python -c "import torch; print(torch.cuda.is_available())"
```

### gRPC connection refused

- Đảm bảo Python backend đang chạy trước
- Kiểm tra port 50053 chưa bị chiếm
- Xem logs để debug

### OCR timeout

- Tăng timeout trong `ocr.service.ts` (mặc định 5 phút)
- PDF quá lớn có thể mất nhiều thời gian
- Kiểm tra GPU memory

## Performance

- OCR tốc độ phụ thuộc GPU (RTX 4090, A100, H100)
- Khoảng $200/1M pages (theo olmocr benchmark)
- Timeout mặc định: 5 phút/request

## License

Apache 2.0 (theo olmocr)
