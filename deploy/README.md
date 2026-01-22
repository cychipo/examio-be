# Examio Backend - Docker Deployment Guide

This guide explains how to deploy the Examio backend using Docker with containerized PostgreSQL and Redis databases.

## Architecture Overview

The deployment consists of the following containers:
- **PostgreSQL** (Database)
- **Redis** (Cache)
- **RabbitMQ** (Message Queue)
- **Gateway Service** (API Gateway)
- **Auth Service** (Authentication)
- **Exam Service** (Exam Management)
- **Finance Service** (Payment & Wallet)
- **R2 Service** (File Storage)
- **AI Service** (AI Features)
- **Migration** (Database migrations - runs once)

## Prerequisites

- Docker Engine 20.10+
- Docker Compose 2.0+
- At least 4GB RAM available
- 20GB disk space

## Deployment Steps

### 1. Copy Deployment Files

Copy the deployment files to your server:

```bash
# Copy docker-compose.yml
cp examio-be/deploy/docker-compose.yml ./docker-compose.yml

# Copy and configure environment
cp examio-be/.env.example .env
```

### 2. Configure Environment Variables

Edit the `.env` file and update the following critical values:

#### Database Configuration (PostgreSQL Container)
```bash
POSTGRES_USER=examio
POSTGRES_PASSWORD=your_strong_password_here
POSTGRES_DB=examio

# Database URL uses container hostname 'postgres'
DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
```

#### Redis Configuration (Redis Container)
```bash
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=  # Leave empty or set a password
```

#### Security (REQUIRED - Change these!)
```bash
JWT_SECRET=change_this_to_a_secure_random_string_min_32_chars
JWT_EXPIRATION=1d
REFRESH_TOKEN_SECRET=change_this_to_another_secure_string
REFRESH_TOKEN_EXPIRATION=7d
QUIZ_JWT_SECRET=change_this_to_quiz_secret_32_chars_min
QUIZ_AES_KEY=change_this_to_aes_key_32_chars_min
```

#### RabbitMQ Configuration
```bash
RABBITMQ_USER=admin
RABBITMQ_PASS=secure_password_here
RABBITMQ_URL=amqp://admin:secure_password_here@rabbitmq:5672
```

#### AI Service (Gemini)
```bash
GEMINI_API_KEYS=key1,key2
GEMINI_MODEL_NAMES=gemini-2.0-flash,gemini-1.5-flash
```

#### R2 Storage (Cloudflare)
```bash
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_access_key
R2_SECRET_ACCESS_KEY=your_secret_key
R2_BUCKET_NAME=examio
R2_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
R2_PUBLIC_URL=https://pub-....r2.dev
```

#### Payment (SePay)
```bash
PAYMENT_SERVICE_SEPAY_KEY=your_sepay_key
PAYMENT_BASE_URL=https://my.sepay.vn
PAYMENT_QR_BANK_ACCOUNT=your_bank_account
PAYMENT_QR_BANK_CODE=your_bank_code
PAYMENT_WEBHOOK_SECRET_KEY=your_webhook_secret
```

#### OAuth Providers (Optional)
Configure Google, Facebook, and GitHub OAuth if needed.

### 3. Build and Start Services

```bash
# Build all services
docker compose build

# Start all services in detached mode
docker compose up -d

# View logs
docker compose logs -f

# View logs for specific service
docker compose logs -f gateway
```

### 4. Verify Deployment

Check service health:

```bash
# Check all containers are running
docker compose ps

# Check gateway health
curl http://localhost:6369/api/v1/health

# Check RabbitMQ management (if exposed)
# Access http://your-server:15672 (default: admin/admin)
```

### 5. Database Migration

The migration container runs automatically on startup. Check its logs:

```bash
docker compose logs migration
```

## Container Ports

External ports exposed to host:

- **6369** → Gateway (7000 internally)
- **5432** → PostgreSQL
- **6379** → Redis
- **5672** → RabbitMQ
- **15672** → RabbitMQ Management UI

## Data Persistence

Data is persisted in Docker volumes:

- `postgres_data` - PostgreSQL database
- `redis_data` - Redis cache
- `rabbitmq_data` - RabbitMQ data

To backup volumes:

```bash
# Backup PostgreSQL
docker compose exec postgres pg_dump -U examio examio > backup.sql

# Restore PostgreSQL
docker compose exec -T postgres psql -U examio examio < backup.sql
```

## Useful Commands

```bash
# Stop all services
docker compose down

# Stop and remove volumes (WARNING: destroys data!)
docker compose down -v

# Restart a specific service
docker compose restart gateway

# Scale a service (if needed)
docker compose up -d --scale exam=2

# View resource usage
docker compose stats

# Execute command in container
docker compose exec gateway sh
docker compose exec postgres psql -U examio
docker compose exec redis redis-cli
```

## Troubleshooting

### Services failing to start

1. Check logs: `docker compose logs <service-name>`
2. Verify environment variables in `.env`
3. Ensure all dependencies are healthy: `docker compose ps`

### Database connection issues

1. Verify DATABASE_URL uses `postgres` as hostname (not `localhost`)
2. Check PostgreSQL is healthy: `docker compose ps postgres`
3. Test connection: `docker compose exec postgres pg_isready`

### Redis connection issues

1. Verify REDIS_HOST is set to `redis` (not `localhost`)
2. Check Redis is healthy: `docker compose ps redis`
3. Test connection: `docker compose exec redis redis-cli ping`

### Migration failures

1. Check migration logs: `docker compose logs migration`
2. Ensure PostgreSQL is running before migration
3. Manually run migration: `docker compose run --rm migration`

### Container keeps restarting

1. Check logs: `docker compose logs <service-name>`
2. Verify healthcheck endpoint is responding
3. Check resource limits (memory/CPU)

## Security Recommendations

1. **Change all default passwords** in `.env` file
2. **Use strong secrets** for JWT tokens (32+ characters)
3. **Restrict exposed ports** using firewall rules
4. **Enable Redis password** by setting REDIS_PASSWORD
5. **Use SSL/TLS** in production with a reverse proxy (nginx/traefik)
6. **Regular backups** of PostgreSQL data
7. **Monitor logs** for suspicious activity

## Production Checklist

- [ ] All secrets changed from defaults
- [ ] Firewall configured (only expose necessary ports)
- [ ] SSL/TLS enabled via reverse proxy
- [ ] Database backups scheduled
- [ ] Monitoring/alerting configured
- [ ] Log rotation configured
- [ ] Resource limits set on containers
- [ ] Environment variables validated
- [ ] Health checks responding correctly

## Updating Services

To update a service:

```bash
# Pull latest code
git pull

# Rebuild specific service
docker compose build gateway

# Restart service with zero downtime (if using multiple instances)
docker compose up -d --no-deps gateway

# Or restart all services
docker compose up -d --build
```

## Support

For issues or questions, please refer to the main project documentation or create an issue in the repository.
