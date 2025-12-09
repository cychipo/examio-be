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
RUN pnpm prisma:merge && pnpm prisma:generate

# Build ứng dụng NestJS
RUN pnpm build

# Stage 3: Production runner
FROM node:20-alpine AS runner

# Cài đặt pnpm và các dependencies cần thiết cho tesseract và pdf processing
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate && \
    apk add --no-cache \
    tesseract-ocr \
    tesseract-ocr-data-eng \
    tesseract-ocr-data-vie \
    graphicsmagick \
    ghostscript

WORKDIR /app

# Copy package files
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-lock.yaml ./pnpm-lock.yaml

# Copy prisma schema (needed for prisma generate)
COPY --from=builder /app/prisma ./prisma

# Install production dependencies and generate Prisma client
RUN pnpm install --prod --frozen-lockfile && pnpm prisma:generate

# Copy built application
COPY --from=builder /app/dist ./dist

# Copy các file cần thiết cho runtime
COPY --from=builder /app/eng.traineddata ./eng.traineddata
COPY --from=builder /app/vie.traineddata ./vie.traineddata

# Copy templates nếu có
COPY --from=builder /app/src/templates ./src/templates

# Expose port
EXPOSE 3000

# Start application
CMD ["node", "dist/src/main"]
