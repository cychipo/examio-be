# ExamIO - Microservices Ecosystem

ExamIO là một hệ thống học tập và thi cử thông minh, tích hợp AI mạnh mẽ, được xây dựng trên kiến trúc Microservices Polyglot (NestJS & Python).

## 🚀 Hệ thống Microservices

Hệ thống bao gồm các dịch vụ chính nằm trong thư mục `apps/`:

### 1. **Auth Service (NestJS)**
- **Chức năng**: Quản lý định danh (OAuth2: Google, Facebook, GitHub), quản lý thiết bị & session, thông tin cá nhân.
- **Port mặc định**: 3001

### 2. **Exam Service (NestJS)**
- **Chức năng**: Quản lý ngân hàng câu hỏi (Quiz), bộ Flashcard, phòng thi (Exam Room), tổ chức ca thi và ghi nhận lịch sử gian lận (Cheating Log).
- **Port mặc định**: 3002

### 3. **Finance Service (NestJS)**
- **Chức năng**: Quản lý ví điện tử, xử lý thanh toán tự động qua SePay, lịch sử giao dịch.
- **Port mặc định**: 3003

### 4. **Chatbot Agent (Python FastAPI)**
- **Chức năng**: Phân tích tài liệu (OCR - Docling), tìm kiếm ngữ nghĩa (RAG/GraphRAG), AI Agent tư vấn học tập.
- **Port mặc định**: 8000

---

## 🛠 Thư viện dùng chung (Libraries)

Nằm trong thư mục `libs/`:
- **`@examio/database`**: Chứa Prisma Client và cấu hình Database dùng chung.
- **`@examio/common`**: Chứa các Service dùng chung như Mail, Password, Guards và các file `.proto`.

---

## 🔄 Luồng hoạt động chính

1. **Người dùng đăng nhập**: Qua Gateway -> Auth Service. Sau khi thành công, Auth Service bắn Event `USER_CREATED` (nếu là user mới) qua RabbitMQ.
2. **Khởi tạo ví**: Finance Service lắng nghe Event và tạo ví mới cho User.
3. **Thi cử & Học tập**: Người dùng tương tác với Exam Service. Các tác vụ nặng như chấm điểm PDF sẽ được đẩy qua Queue.
4. **Hỗ trợ AI**: Khi người dùng hỏi chatbot, yêu cầu đi qua AI Agent Service. Nếu cần dữ liệu điểm số, AI Agent sẽ gọi Internal API/gRPC đến Exam Service.

---

## 💻 Hướng dẫn chạy Development

### Điều kiện tiên quyết (Prerequisites)
- Node.js (v20+) & **pnpm**
- Python (v3.9+)
- Docker (để chạy PostgreSQL, MongoDB, RabbitMQ, Redis)

### Bước 1: Cài đặt Dependencies
```bash
# NestJS (Đã bao gồm @nestjs/cli trong devDependencies)
pnpm install

# Python AI Agent - Cài đặt môi trường ảo
cd apps/chatbot-agent
python3 -m venv venv
source venv/bin/activate   # Linux/macOS
# .\venv\Scripts\activate  # Windows
pip install -r requirements.txt
```

> [!IMPORTANT]
> Dự án sử dụng `@nestjs/cli` được cài đặt nội bộ. Bạn **không nhất thiết** phải cài đặt Nest CLI toàn cục. Nếu muốn dùng lệnh `nest` trực tiếp từ terminal, hãy dùng `npx nest`.

### Bước 2: Cấu hình Environment Variables
Mỗi microservice có file `.env.example` riêng. Copy và cấu hình cho từng service:

```bash
# Auth Service
cp apps/auth-service/.env.example apps/auth-service/.env

# Exam Service
cp apps/exam-service/.env.example apps/exam-service/.env

# Finance Service
cp apps/finance-service/.env.example apps/finance-service/.env

# AI Agent Service
cp apps/chatbot-agent/.env.example apps/chatbot-agent/.env
```

> [!TIP]
> Các biến môi trường chung như `DATABASE_URL` nên giống nhau giữa các service NestJS. Xem chi tiết trong từng file `.env.example`.

### Bước 3: Khởi tạo Database
```bash
pnpm prisma:generate
pnpm prisma:push
```

### Bước 4: Chạy các Services
Nên mở mỗi service trên một tab terminal riêng:

```bash
# Auth Service
npx nest start auth-service --watch

# Exam Service
npx nest start exam-service --watch

# Finance Service
npx nest start finance-service --watch

# AI Agent (Cần kích hoạt venv trước)
cd apps/chatbot-agent && ./venv/bin/uvicorn main:app --reload --port 8000
```

---

## 🏗 Hướng dẫn Build

### Build NestJS Services
```bash
# Build tất cả
pnpm build

# Build cụ thể một service
npx nest build <service-name>
```

### Build Docker (Production)
```bash
docker-compose build
docker-compose up -d
```

---

## 📝 Ghi chú Kỹ thuật
- **Communication**: gRPC (Sync) & RabbitMQ (Async).
- **Storage**: Cloudflare R2 cho tài liệu và hình ảnh.
- **AI Stack**: LangChain, LangGraph, Gemini, Docling.
