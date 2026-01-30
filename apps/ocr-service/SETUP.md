# OCR Service Setup Guide

## Cấu trúc thư mục

```
examio/
├── examio-be/
│   └── apps/
│       └── ocr-service/           # Service này
└── olmocr/                        # Repo olmocr (đã clone)
```

## Cách hoạt động

OCR service sử dụng olmocr từ thư mục `../../olmocr` (tương đối với ocr-service).

Python backend sẽ:
1. Load olmocr module từ OLMOCR_PATH
2. Gọi `olmocr.pipeline` để xử lý PDF
3. Trả kết quả về cho NestJS service

## Quick Start

```bash
# 1. Cài dependencies cho olmocr (nếu chưa)
cd examio/olmocr
pip install -e .[gpu] --extra-index-url https://download.pytorch.org/whl/cu128

# 2. Setup OCR service
cd ../examio-be/apps/ocr-service
cp .env.example .env

# 3. Chỉnh .env, thêm:
echo "OLMOCR_PATH=$(pwd)/../../olmocr" >> .env

# 4. Cài Python dependencies
pip install -r requirements.txt

# 5. Chạy service
cd ../../  # về root examio-be
pnpm dev:ocr-python  # Terminal 1
pnpm dev:ocr         # Terminal 2
```

## Environment Variables

```env
OLMOCR_PATH=/Users/tobi/devs/examio/olmocr
```

Script `dev:ocr-python` trong package.json đã tự động set:
- `PYTHONPATH=src:../../olmocr` - để import olmocr
- `OLMOCR_PATH=../../olmocr` - truyền vào main.py

## Test

```bash
curl -X POST http://127.0.0.1:8003/api/ocr/process \
  -F "file=@test.pdf"
```
