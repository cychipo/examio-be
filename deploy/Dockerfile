# =============================================================================
# Examio NestJS - ULTRA MINIMAL Dockerfile (Target: ~150MB)
# =============================================================================
ARG SERVICE_NAME=gateway-service
ARG ENABLE_OCR=false

# Stage 1: Build
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm prisma:merge && pnpm prisma:generate && pnpm build ${SERVICE_NAME}

# Stage 2: Production deps only
FROM node:20-alpine AS deps
ARG SERVICE_NAME
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate
WORKDIR /app
COPY --from=builder /app/package.json /app/pnpm-lock.yaml ./
COPY --from=builder /app/libs ./libs
RUN pnpm install --prod --frozen-lockfile && \
    pnpm prisma:generate && \
    # AGGRESSIVE CLEANUP - remove everything unnecessary
    rm -rf /root/.local /root/.cache /tmp/* node_modules/.cache && \
    find node_modules -name "*.md" -delete 2>/dev/null || true && \
    find node_modules -name "*.map" -delete 2>/dev/null || true && \
    find node_modules -name "*.ts" ! -name "*.d.ts" -delete 2>/dev/null || true && \
    find node_modules -name "CHANGELOG*" -delete 2>/dev/null || true && \
    find node_modules -name "LICENSE*" -delete 2>/dev/null || true && \
    find node_modules -name "README*" -delete 2>/dev/null || true && \
    find node_modules -type d -name "test" -exec rm -rf {} + 2>/dev/null || true && \
    find node_modules -type d -name "tests" -exec rm -rf {} + 2>/dev/null || true && \
    find node_modules -type d -name "__tests__" -exec rm -rf {} + 2>/dev/null || true && \
    find node_modules -type d -name "docs" -exec rm -rf {} + 2>/dev/null || true && \
    find node_modules -type d -name ".git" -exec rm -rf {} + 2>/dev/null || true && \
    find node_modules -type d -name "example" -exec rm -rf {} + 2>/dev/null || true && \
    find node_modules -type d -name "examples" -exec rm -rf {} + 2>/dev/null || true && \
    pnpm store prune

# Stage 3: Minimal runtime
FROM node:20-alpine AS runner
ARG SERVICE_NAME
ARG ENABLE_OCR
ENV SERVICE_NAME=${SERVICE_NAME} NODE_ENV=production

# Minimal packages
RUN apk add --no-cache wget && \
    if [ "$ENABLE_OCR" = "true" ]; then \
      apk add --no-cache tesseract-ocr tesseract-ocr-data-eng graphicsmagick ghostscript; \
    fi && \
    rm -rf /var/cache/apk/* /tmp/*

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=deps /app/libs ./libs

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=30s \
    CMD wget -q --spider http://localhost:${PORT:-3000}/api/v1/health || exit 1
CMD ["sh", "-c", "node dist/apps/${SERVICE_NAME}/main"]
