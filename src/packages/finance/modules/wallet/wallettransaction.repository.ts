import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/common/repositories/base.repository';
import { PrismaService } from 'src/prisma/prisma.service';
import { RedisService } from 'src/packages/redis/redis.service';
import { WalletTransaction } from '@prisma/client';
import { EXPIRED_TIME } from 'src/constants/redis';

@Injectable()
export class WalletTransactionRepository extends BaseRepository<WalletTransaction> {
    protected modelName = 'walletTransaction';
    protected cachePrefix = 'wallet_transaction';
    protected defaultCacheTTL = EXPIRED_TIME.FIVE_MINUTES;

    constructor(prisma: PrismaService, redis: RedisService) {
        super(prisma, redis);
    }

    /**
     * Tìm transactions theo wallet ID
     */
    async findByWalletId(
        walletId: string,
        limit = 50,
        cache = true,
        cacheTTL = this.defaultCacheTTL
    ): Promise<WalletTransaction[]> {
        return this.findAll({
            where: { walletId },
            orderBy: { createdAt: 'desc' },
            take: limit,
            cache,
            cacheTTL,
        });
    }

    /**
     * Tạo transaction mới
     */
    async createTransaction(data: {
        walletId: string;
        amount: number;
        type: number;
        description?: string;
        transactionId?: string;
        userId?: string;
    }): Promise<WalletTransaction> {
        // BaseRepository.create() handles cache invalidation automatically
        return this.create(
            {
                id: data.transactionId,
                walletId: data.walletId,
                amount: data.amount,
                type: data.type,
                description: data.description,
            },
            data.userId
        );
    }

    /**
     * Get transaction statistics
     */
    async getStatistics(walletId: string): Promise<{
        totalIncome: number;
        totalExpense: number;
        transactionCount: number;
    }> {
        const cacheKey = this.getCacheKey(`stats:${walletId}`);
        const cached = await this.redis.get<any>(cacheKey);
        if (cached) return cached;

        const transactions = await this.findByWalletId(walletId, 1000, false);

        const stats = transactions.reduce(
            (acc, tx) => {
                if (tx.amount > 0) {
                    acc.totalIncome += tx.amount;
                } else {
                    acc.totalExpense += Math.abs(tx.amount);
                }
                acc.transactionCount++;
                return acc;
            },
            { totalIncome: 0, totalExpense: 0, transactionCount: 0 }
        );

        await this.redis.set(cacheKey, stats, EXPIRED_TIME.TEN_MINUTES);

        return stats;
    }
}
