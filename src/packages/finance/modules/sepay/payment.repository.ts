import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/common/repositories/base.repository';
import { PrismaService } from 'src/prisma/prisma.service';
import { RedisService } from 'src/packages/redis/redis.service';
import { Payment } from '@prisma/client';
import { EXPIRED_TIME } from 'src/constants/redis';

@Injectable()
export class PaymentRepository extends BaseRepository<Payment> {
    protected modelName = 'payment';
    protected cachePrefix = 'payment';
    protected defaultCacheTTL = EXPIRED_TIME.FIVE_MINUTES;

    constructor(prisma: PrismaService, redis: RedisService) {
        super(prisma, redis);
    }

    /**
     * Tìm payments theo user ID
     */
    async findByUserId(
        userId: string,
        cache = true,
        cacheTTL = this.defaultCacheTTL
    ): Promise<Payment[]> {
        return this.findAll({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            cache,
            cacheTTL,
        });
    }

    /**
     * Tìm pending payments
     */
    async findPendingByUser(
        userId: string,
        cache = false // Không cache pending payments
    ): Promise<Payment[]> {
        return this.findAll({
            where: {
                userId,
                status: 0, // 0: unpaid
            },
            orderBy: { createdAt: 'desc' },
            cache,
        });
    }

    /**
     * Tìm paid payments
     */
    async findPaidByUser(
        userId: string,
        cache = true,
        cacheTTL = EXPIRED_TIME.TEN_MINUTES
    ): Promise<Payment[]> {
        return this.findAll({
            where: {
                userId,
                status: 1, // 1: paid
            },
            orderBy: { createdAt: 'desc' },
            cache,
            cacheTTL,
        });
    }

    /**
     * Update payment status
     */
    async updateStatus(id: string, status: number): Promise<Payment> {
        const updated = await this.update(id, { status });

        // Invalidate caches
        await this.invalidateCache();

        return updated;
    }

    /**
     * Get payment statistics for user
     */
    async getUserStatistics(userId: string): Promise<{
        totalPaid: number;
        totalPending: number;
        paymentCount: number;
    }> {
        const cacheKey = this.getCacheKey(`stats:user:${userId}`);
        const cached = await this.redis.get<any>(cacheKey);
        if (cached) return cached;

        const [paid, pending] = await Promise.all([
            this.findPaidByUser(userId, false),
            this.findPendingByUser(userId, false),
        ]);

        const stats = {
            totalPaid: paid.reduce((sum, p) => sum + p.amount, 0),
            totalPending: pending.reduce((sum, p) => sum + p.amount, 0),
            paymentCount: paid.length + pending.length,
        };

        await this.redis.set(cacheKey, stats, EXPIRED_TIME.TEN_MINUTES);

        return stats;
    }
}
