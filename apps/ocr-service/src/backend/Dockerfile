# =============================================================================
# OCR Python Service Backend - GPU Optimized Dockerfile
# Base image with CUDA 12.1 support for modern NVIDIA GPUs (RTX 50xx/40xx)
# =============================================================================

FROM nvidia/cuda:12.1.0-runtime-ubuntu22.04

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/src:/app/olmocr:/app/ai-service-src \
    DEBIAN_FRONTEND=noninteractive

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 \
    python3-pip \
    python3.11-dev \
    tesseract-ocr \
    tesseract-ocr-vie \
    tesseract-ocr-eng \
    poppler-utils \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libffi-dev \
    build-essential \
    curl \
    git \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Set python3.11 as default python
RUN update-alternatives --install /usr/bin/python python /usr/bin/python3.11 1 \
    && update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1

# Copy requirements first for better caching
COPY requirements.txt .

# Install cffi first (required by cryptography)
RUN pip install --no-cache-dir cffi

# Install PyTorch with CUDA 12.1 support and other requirements
RUN pip install --no-cache-dir torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install --no-cache-dir "olmocr[gpu]"

# Create necessary directories
RUN mkdir -p uploads outputs apps/ocr-service/uploads apps/ocr-service/outputs

# Copy source code
COPY src/backend ./src/backend

# Expose port
EXPOSE 8003

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -f http://localhost:8003/health || exit 1

# Start script
CMD ["python", "-m", "src.backend.main"]
