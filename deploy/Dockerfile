# =============================================================================
# Examio NestJS Microservices - Production Optimized Dockerfile
# Target: < 250MB per service
# =============================================================================
# Build: docker build --build-arg SERVICE_NAME=auth-service .
# For OCR: docker build --build-arg SERVICE_NAME=exam-service --build-arg ENABLE_OCR=true .
# =============================================================================

ARG SERVICE_NAME=gateway-service
ARG ENABLE_OCR=false

# Stage 1: Dependencies
FROM node:20-alpine AS dependencies

RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./

# Install all deps for build, prune later
RUN pnpm install --frozen-lockfile

# Stage 2: Builder
FROM node:20-alpine AS builder

ARG SERVICE_NAME

RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

WORKDIR /app

COPY --from=dependencies /app/node_modules ./node_modules
COPY libs ./libs
COPY . .

# Build
RUN pnpm prisma:merge && pnpm prisma:generate && pnpm build ${SERVICE_NAME}

# Stage 3: Production - Minimal
FROM node:20-alpine AS runner

ARG SERVICE_NAME
ARG ENABLE_OCR
ENV SERVICE_NAME=${SERVICE_NAME}

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

# Conditional OCR packages (only if ENABLE_OCR=true)
RUN if [ "$ENABLE_OCR" = "true" ]; then \
      apk add --no-cache tesseract-ocr tesseract-ocr-data-eng tesseract-ocr-data-vie graphicsmagick ghostscript; \
    fi && \
    # Always install wget for healthcheck
    apk add --no-cache wget && \
    # Clean apk cache
    rm -rf /var/cache/apk/*

WORKDIR /app

COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-lock.yaml ./
COPY --from=builder /app/libs ./libs

# Production deps only + cleanup
RUN pnpm install --prod --frozen-lockfile && \
    pnpm prisma:generate && \
    pnpm store prune && \
    rm -rf /root/.local /root/.cache /tmp/* && \
    # Remove unnecessary files from node_modules
    find node_modules -type f -name "*.md" -delete 2>/dev/null || true && \
    find node_modules -type f -name "*.ts" ! -name "*.d.ts" -delete 2>/dev/null || true && \
    find node_modules -type d -name ".git" -exec rm -rf {} + 2>/dev/null || true && \
    find node_modules -type d -name "test" -exec rm -rf {} + 2>/dev/null || true && \
    find node_modules -type d -name "tests" -exec rm -rf {} + 2>/dev/null || true && \
    find node_modules -type d -name "__tests__" -exec rm -rf {} + 2>/dev/null || true

COPY --from=builder /app/dist ./dist

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=40s \
    CMD wget -q --spider http://localhost:${PORT:-3000}/api/v1/health || exit 1

CMD ["sh", "-c", "node dist/apps/${SERVICE_NAME}/main"]
