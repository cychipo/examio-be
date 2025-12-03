import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/common/repositories/base.repository';
import { PrismaService } from 'src/prisma/prisma.service';
import { RedisService } from 'src/packages/redis/redis.service';
import { FlashCardSet } from '@prisma/client';
import { EXPIRED_TIME } from 'src/constants/redis';

@Injectable()
export class FlashCardSetRepository extends BaseRepository<FlashCardSet> {
    protected modelName = 'flashCardSet';
    protected cachePrefix = 'flashcardset';
    protected defaultCacheTTL = EXPIRED_TIME.FIVE_MINUTES;

    constructor(prisma: PrismaService, redis: RedisService) {
        super(prisma, redis);
    }

    /**
     * Tìm flashcard set theo user ID
     */
    async findByUserId(
        userId: string,
        cache = true,
        cacheTTL = this.defaultCacheTTL
    ): Promise<FlashCardSet[]> {
        if (cache) {
            const cacheKey = this.getUserScopedCacheKey(userId) + ':list';
            const cached = await this.redis.get<FlashCardSet[]>(cacheKey);
            if (cached) return cached;

            const data = await this.model.findMany({
                where: { userId },
                orderBy: { createdAt: 'desc' },
            });
            await this.redis.set(cacheKey, data, cacheTTL);
            return data;
        }

        return this.model.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
        });
    }

    /**
     * Tìm public flashcard sets
     */
    async findPublic(
        cache = true,
        cacheTTL = EXPIRED_TIME.TEN_MINUTES
    ): Promise<FlashCardSet[]> {
        return this.findAll({
            where: { isPublic: true },
            orderBy: { createdAt: 'desc' },
            cache,
            cacheTTL,
        });
    }

    /**
     * Tìm flashcard set với cards
     */
    async findByIdWithCards(
        id: string,
        userId?: string,
        cache = true,
        cacheTTL = this.defaultCacheTTL
    ): Promise<any> {
        const cacheKey = userId
            ? this.getItemScopedCacheKey(userId, id, 'cards')
            : this.getPublicScopedCacheKey(id, 'cards');

        if (cache) {
            const cached = await this.redis.get<any>(cacheKey);
            if (cached) return cached;
        }

        const where: any = { id };
        if (userId) {
            where.userId = userId;
        }

        const flashCardSet = await this.model.findUnique({
            where,
            include: {
                detailsFlashCard: {
                    include: {
                        flashCard: true,
                    },
                },
            },
        });

        if (flashCardSet && cache) {
            await this.redis.set(cacheKey, flashCardSet, cacheTTL);
        }

        return flashCardSet;
    }

    /**
     * Search flashcard sets
     */
    async search(
        query: string,
        userId?: string,
        onlyPublic = false,
        cache = true,
        cacheTTL = this.defaultCacheTTL
    ): Promise<FlashCardSet[]> {
        const where: any = {
            OR: [
                { title: { contains: query, mode: 'insensitive' } },
                { tag: { has: query } },
            ],
        };

        if (userId) {
            where.userId = userId;
        }

        if (onlyPublic) {
            where.isPublic = true;
        }

        return this.findAll({
            where,
            orderBy: { createdAt: 'desc' },
            cache,
            cacheTTL,
        });
    }

    /**
     * Toggle pin status
     */
    async togglePin(id: string, userId: string): Promise<FlashCardSet> {
        const flashCardSet = await this.findOne({ where: { id, userId } });
        if (!flashCardSet) {
            throw new Error('FlashCard set not found');
        }

        return this.update(id, { isPinned: !flashCardSet.isPinned }, userId);
    }

    /**
     * Delete flashcard set by user
     */
    async deleteByUser(id: string, userId: string): Promise<{ count: number }> {
        return this.deleteMany({ id, userId }, userId);
    }
}
