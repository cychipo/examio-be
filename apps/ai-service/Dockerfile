# =============================================================================
# Examio AI Service - ULTRA MINIMAL (Target: ~400MB)
# =============================================================================

FROM python:3.12-slim AS builder
WORKDIR /build

# Install build deps
RUN apt-get update && apt-get install -y --no-install-recommends gcc && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

# Install torch CPU ONLY (much smaller than GPU version)
RUN pip install --no-cache-dir --user \
    torch==2.2.0+cpu --index-url https://download.pytorch.org/whl/cpu

# Install other deps
RUN pip install --no-cache-dir --user -r requirements.txt

# AGGRESSIVE CLEANUP
RUN find /root/.local -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true && \
    find /root/.local -type f -name "*.pyc" -delete 2>/dev/null || true && \
    find /root/.local -type f -name "*.pyo" -delete 2>/dev/null || true && \
    find /root/.local -type d -name "tests" -exec rm -rf {} + 2>/dev/null || true && \
    find /root/.local -type d -name "test" -exec rm -rf {} + 2>/dev/null || true && \
    find /root/.local -type d -name "docs" -exec rm -rf {} + 2>/dev/null || true && \
    find /root/.local -name "*.md" -delete 2>/dev/null || true && \
    find /root/.local -name "LICENSE*" -delete 2>/dev/null || true && \
    find /root/.local -name "CHANGELOG*" -delete 2>/dev/null || true

# Stage 2: Minimal runtime
FROM python:3.12-slim
WORKDIR /app

# Only curl for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/* && apt-get clean && \
    rm -rf /tmp/* /var/tmp/*

# Copy site-packages directly to system python
COPY --from=builder /root/.local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /root/.local/bin /usr/local/bin

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PORT=8000

# Copy source
COPY src /app/src

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=30s \
    CMD curl -f http://localhost:${PORT}/health || exit 1
CMD ["sh", "-c", "python -m uvicorn src.backend.main:app --host 0.0.0.0 --port ${PORT}"]
