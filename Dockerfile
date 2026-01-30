# =============================================================================
# Examio NestJS - OPTIMIZED Dockerfile with Better Caching
# =============================================================================
# Build optimization tips:
# - Layer ordering: least changed → most changed
# - Package files copied first (rarely change)
# - Source code copied last (frequently changes)
# =============================================================================
ARG SERVICE_NAME=gateway-service
ARG ENABLE_OCR=false

# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: Base - Shared dependencies (cached across all services)
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate
WORKDIR /app

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: Dependencies - Install all deps (cached if lockfile unchanged)
# ─────────────────────────────────────────────────────────────────────────────
FROM base AS deps
# Copy only package files first (better cache)
COPY package.json pnpm-lock.yaml ./
COPY libs/database/prisma ./libs/database/prisma/
# Install all dependencies
RUN pnpm install --frozen-lockfile

# ─────────────────────────────────────────────────────────────────────────────
# Stage 3: Builder - Compile TypeScript
# ─────────────────────────────────────────────────────────────────────────────
FROM deps AS builder
ARG SERVICE_NAME
# Copy source code (changes frequently - separate layer)
COPY libs ./libs
COPY apps ./apps
COPY tsconfig*.json nest-cli.json ./
# Generate Prisma and build
RUN pnpm prisma:merge && pnpm prisma:generate && pnpm build ${SERVICE_NAME}

# ─────────────────────────────────────────────────────────────────────────────
# Stage 4: Production deps - Minimal node_modules
# ─────────────────────────────────────────────────────────────────────────────
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml ./
COPY --from=builder /app/libs ./libs
RUN pnpm install --prod --frozen-lockfile && \
    pnpm prisma:generate && \
    # Cleanup unnecessary files
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
    find node_modules -type d -name "example*" -exec rm -rf {} + 2>/dev/null || true && \
    pnpm store prune

# ─────────────────────────────────────────────────────────────────────────────
# Stage 5: Runner - Minimal production image
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
ARG SERVICE_NAME
ARG ENABLE_OCR
ENV SERVICE_NAME=${SERVICE_NAME} NODE_ENV=production

# Install minimal runtime dependencies
RUN apk add --no-cache wget && \
    if [ "$ENABLE_OCR" = "true" ]; then \
    apk add --no-cache tesseract-ocr tesseract-ocr-data-eng tesseract-ocr-data-vie graphicsmagick ghostscript poppler-utils; \
    fi && \
    rm -rf /var/cache/apk/* /tmp/*

WORKDIR /app

# Copy production artifacts
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=prod-deps /app/libs ./libs
COPY templates ./templates


EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=30s \
    CMD wget -q --spider http://localhost:${PORT:-3000}/api/v1/health || exit 1

CMD ["sh", "-c", "node dist/apps/${SERVICE_NAME}/main"]
