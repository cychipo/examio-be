import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/common/repositories/base.repository';
import { PrismaService } from 'src/prisma/prisma.service';
import { RedisService } from 'src/packages/redis/redis.service';
import { Wallet } from '@prisma/client';
import { EXPIRED_TIME } from 'src/constants/redis';

@Injectable()
export class WalletRepository extends BaseRepository<Wallet> {
    protected modelName = 'wallet';
    protected cachePrefix = 'wallet';
    protected defaultCacheTTL = EXPIRED_TIME.FIVE_MINUTES;

    constructor(prisma: PrismaService, redis: RedisService) {
        super(prisma, redis);
    }

    /**
     * Tìm wallet theo user ID với cache
     */
    async findByUserId(
        userId: string,
        cache = true,
        cacheTTL = this.defaultCacheTTL
    ): Promise<Wallet | null> {
        if (cache) {
            const cacheKey = this.getUserScopedCacheKey(userId);
            const cached = await this.redis.get<Wallet>(cacheKey);
            if (cached) return cached;

            const wallet = await this.model.findUnique({
                where: { userId },
            });

            if (wallet) {
                await this.redis.set(cacheKey, wallet, cacheTTL);
            }
            return wallet;
        }

        return this.model.findUnique({
            where: { userId },
        });
    }

    /**
     * Tìm wallet với transactions
     */
    async findByUserIdWithTransactions(
        userId: string,
        cache = true,
        cacheTTL = this.defaultCacheTTL
    ): Promise<any> {
        const cacheKey = this.getUserScopedCacheKey(userId) + ':transactions';

        if (cache) {
            const cached = await this.redis.get<any>(cacheKey);
            if (cached) return cached;
        }

        const wallet = await this.model.findUnique({
            where: { userId },
            include: {
                transactions: {
                    orderBy: { createdAt: 'desc' },
                    take: 50, // Limit last 50 transactions
                },
            },
        });

        if (wallet && cache) {
            await this.redis.set(cacheKey, wallet, cacheTTL);
        }

        return wallet;
    }

    /**
     * Update balance
     */
    async updateBalance(
        userId: string,
        amount: number,
        operation: 'add' | 'subtract' = 'add'
    ): Promise<Wallet> {
        const wallet = await this.findByUserId(userId, false);
        if (!wallet) {
            throw new Error('Wallet not found');
        }

        const newBalance =
            operation === 'add'
                ? wallet.balance + amount
                : wallet.balance - amount;

        if (newBalance < 0) {
            throw new Error('Insufficient balance');
        }

        // BaseRepository.update() handles cache invalidation automatically
        return this.update(wallet.id, { balance: newBalance }, userId);
    }

    /**
     * Create wallet for new user
     */
    async createForUser(
        userId: string,
        initialBalance = 20,
        walletId?: string
    ): Promise<Wallet> {
        const wallet = await this.create(
            {
                id: walletId,
                userId,
                balance: initialBalance,
            },
            userId
        );

        // Set user-scoped cache
        const cacheKey = this.getUserScopedCacheKey(userId);
        await this.redis.set(cacheKey, wallet, this.defaultCacheTTL);

        return wallet;
    }
}
