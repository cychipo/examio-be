# =============================================================================
# Examio NestJS Microservices Multi-Stage Dockerfile
# =============================================================================
# Build specific service: docker build --build-arg SERVICE_NAME=gateway-service .
# =============================================================================

# Build argument for service name
ARG SERVICE_NAME=gateway-service

# Stage 1: Dependencies
FROM node:20-alpine AS dependencies

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

WORKDIR /app

# Copy package files for Docker layer caching
COPY package.json pnpm-lock.yaml ./

# Install dependencies (cached if package.json unchanged)
RUN pnpm install --frozen-lockfile

# Stage 2: Builder
FROM node:20-alpine AS builder

ARG SERVICE_NAME

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

WORKDIR /app

# Copy dependencies from previous stage
COPY --from=dependencies /app/node_modules ./node_modules

# Copy libs (containing prisma schema)
COPY libs ./libs

# Copy source code and config files
COPY . .

# Merge prisma schemas and generate Prisma Client
RUN pnpm prisma:merge && pnpm prisma:generate

# Build specific service
RUN pnpm build ${SERVICE_NAME}

# Stage 3: Production runner
FROM node:20-alpine AS runner

ARG SERVICE_NAME
ENV SERVICE_NAME=${SERVICE_NAME}

# Install pnpm and required dependencies for tesseract and pdf processing
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate && \
    apk add --no-cache \
    tesseract-ocr \
    tesseract-ocr-data-eng \
    tesseract-ocr-data-vie \
    graphicsmagick \
    ghostscript \
    curl \
    wget

WORKDIR /app

# Copy package files
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-lock.yaml ./pnpm-lock.yaml

# Copy libs (containing prisma schema)
COPY --from=builder /app/libs ./libs

# Install production dependencies and generate Prisma client
RUN pnpm install --prod --frozen-lockfile && pnpm prisma:generate && pnpm store prune && rm -rf /root/.local /root/.cache

# Copy built application
COPY --from=builder /app/dist ./dist

# Copy traineddata files if they exist
COPY --from=builder /app/*.traineddata ./

# Copy templates if they exist
COPY --from=builder /app/templates ./templates

# Expose port (will be overridden by docker-compose)
EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=40s \
    CMD wget -q --spider http://localhost:${PORT:-3000}/health || exit 1

# Start the specific service
CMD ["sh", "-c", "node dist/apps/${SERVICE_NAME}/main"]
