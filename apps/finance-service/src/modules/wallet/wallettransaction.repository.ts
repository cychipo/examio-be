import { Injectable } from '@nestjs/common';
import { BaseRepository, PaginationResult } from '@examio/common';
import { PrismaService } from '@examio/database';
import { RedisService, EXPIRED_TIME } from '@examio/redis';
import { WalletTransaction } from '@prisma/client';

@Injectable()
export class WalletTransactionRepository extends BaseRepository<WalletTransaction> {
    protected modelName = 'walletTransaction';
    protected cachePrefix = 'wallet_transaction';
    protected defaultCacheTTL = EXPIRED_TIME.FIVE_MINUTES;

    constructor(prisma: PrismaService, redis: RedisService) {
        super(prisma, redis);
    }

    /**
     * Tìm transactions theo wallet ID với phân trang
     */
    async paginateByWalletId(
        walletId: string,
        page = 1,
        size = 10,
        cache = true,
        cacheTTL = this.defaultCacheTTL
    ): Promise<PaginationResult<WalletTransaction>> {
        // Ensure page and size are integers (query params come as strings)
        const pageNum = Number(page) || 1;
        const sizeNum = Number(size) || 10;

        const cacheKey = `${this.cachePrefix}:wallet:${walletId}:page:${pageNum}:size:${sizeNum}`;

        if (cache) {
            const cached =
                await this.redis.get<PaginationResult<WalletTransaction>>(
                    cacheKey
                );
            if (cached) return cached;
        }

        const skip = (pageNum - 1) * sizeNum;

        const [data, total] = await Promise.all([
            this.model.findMany({
                where: { walletId },
                orderBy: { createdAt: 'desc' },
                skip,
                take: sizeNum,
            }),
            this.model.count({ where: { walletId } }),
        ]);

        const result: PaginationResult<WalletTransaction> = {
            data,
            total,
            page: pageNum,
            size: sizeNum,
            totalPages: Math.ceil(total / sizeNum),
        };

        if (cache) {
            await this.redis.set(cacheKey, result, cacheTTL);
        }

        return result;
    }

    /**
     * Tìm transactions theo wallet ID (legacy)
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
     * Get transaction statistics - O(1) with cache
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
                if (tx.direction === 'ADD') {
                    acc.totalIncome += tx.amount;
                } else {
                    acc.totalExpense += tx.amount;
                }
                acc.transactionCount++;
                return acc;
            },
            { totalIncome: 0, totalExpense: 0, transactionCount: 0 }
        );

        await this.redis.set(cacheKey, stats, EXPIRED_TIME.TEN_MINUTES);

        return stats;
    }

    /**
     * Get usage breakdown grouped by transaction type
     * Returns total used credits per transaction type
     */
    async getUsageBreakdownByType(walletId: string): Promise<{
        [type: number]: number;
    }> {
        const cacheKey = this.getCacheKey(`usage_breakdown:${walletId}`);
        const cached = await this.redis.get<{ [type: number]: number }>(
            cacheKey
        );
        if (cached) return cached;

        // Get all SUBTRACT transactions
        const transactions = await this.model.findMany({
            where: {
                walletId,
                direction: 'SUBTRACT',
            },
        });

        // Group by type
        const breakdown = transactions.reduce(
            (acc, tx) => {
                acc[tx.type] = (acc[tx.type] || 0) + tx.amount;
                return acc;
            },
            {} as { [type: number]: number }
        );

        await this.redis.set(cacheKey, breakdown, EXPIRED_TIME.TEN_MINUTES);

        return breakdown;
    }

    /**
     * Invalidate all cache for a wallet
     */
    async invalidateWalletCache(walletId: string): Promise<void> {
        // Clear stats, usage breakdown, and pagination cache
        await Promise.all([
            this.redis.del(this.getCacheKey(`stats:${walletId}`)),
            this.redis.del(this.getCacheKey(`usage_breakdown:${walletId}`)),
            // Clear all pagination cache for this wallet
            this.redis.delPattern(
                this.getCacheKey(`wallet:${walletId}:page:*`)
            ),
        ]);
    }
}
