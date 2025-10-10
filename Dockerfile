# Stage 1: Dependencies
FROM node:20-alpine AS dependencies

# Cài đặt pnpm
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

WORKDIR /app

# Copy package files để tận dụng Docker layer caching
COPY package.json pnpm-lock.yaml ./

# Cài đặt dependencies (sẽ được cache nếu package.json không thay đổi)
RUN pnpm install --frozen-lockfile

# Stage 2: Builder
FROM node:20-alpine AS builder

# Cài đặt pnpm
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

WORKDIR /app

# Copy dependencies từ stage trước
COPY --from=dependencies /app/node_modules ./node_modules

# Copy prisma schema files
COPY prisma ./prisma

# Copy source code và config files
COPY . .

# Merge prisma schemas và generate Prisma Client
RUN pnpm prisma:merge && pnpm exec prisma generate

# Build ứng dụng NestJS
RUN pnpm build

# Stage 3: Production dependencies
FROM node:20-alpine AS production-dependencies

# Cài đặt pnpm
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Cài đặt chỉ production dependencies
RUN pnpm install --prod --frozen-lockfile

# Stage 4: Production runner
FROM node:20-alpine AS runner

# Cài đặt các dependencies cần thiết cho tesseract và pdf processing
RUN apk add --no-cache \
    tesseract-ocr \
    tesseract-ocr-data-eng \
    tesseract-ocr-data-vie \
    graphicsmagick \
    ghostscript

WORKDIR /app

# Copy production dependencies
COPY --from=production-dependencies /app/node_modules ./node_modules

# Copy built application
COPY --from=builder /app/dist ./dist

# Copy prisma schema và generated client
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Copy các file cần thiết cho runtime
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/eng.traineddata ./eng.traineddata
COPY --from=builder /app/vie.traineddata ./vie.traineddata

# Copy templates nếu có
COPY --from=builder /app/src/templates ./src/templates

# Tạo non-root user để chạy application (security best practice)
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001 && \
    chown -R nestjs:nodejs /app

USER nestjs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start application
CMD ["node", "dist/src/main"]
