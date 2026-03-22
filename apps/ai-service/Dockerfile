# =============================================================================
# Examio AI Service - LIGHTWEIGHT (Optimized for Local OCR & API AI)
# =============================================================================

FROM python:3.12-slim AS builder
WORKDIR /build

# Install build deps
RUN apt-get update && apt-get install -y --no-install-recommends gcc python3-dev && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

# Install dependencies (NO TORCH - saves ~500MB)
RUN pip install --no-cache-dir --user -r requirements.txt

# AGGRESSIVE CLEANUP of site-packages
RUN find /root/.local -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true && \
    find /root/.local -name "*.pyc" -delete 2>/dev/null || true && \
    find /root/.local -type d -name "tests" -exec rm -rf {} + 2>/dev/null || true && \
    find /root/.local -type d -name "docs" -exec rm -rf {} + 2>/dev/null || true

# Stage 2: Minimal runtime
FROM python:3.12-slim
WORKDIR /app

# Install system dependencies for OCR and Image Processing
# - tesseract-ocr & tesseract-ocr-vie: Required for local OCR
# - poppler-utils: Required for pdf2image (PDF to Image conversion)
# - libgl1 & libglib2.0-0: Required for OpenCV (image preprocessing)
# - curl: For container health checks
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-vie \
    poppler-utils \
    libgl1 \
    libglib2.0-0 \
    curl && \
    rm -rf /var/lib/apt/lists/* && \
    apt-get clean && \
    rm -rf /tmp/* /var/tmp/*

# Copy installed python packages from builder
COPY --from=builder /root/.local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /root/.local/bin /usr/local/bin

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PORT=8000

# Copy source code
COPY src /app/src

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=30s \
    CMD curl -f http://localhost:${PORT}/health || exit 1

CMD ["sh", "-c", "python -m uvicorn src.backend.main:app --host 0.0.0.0 --port ${PORT}"]
