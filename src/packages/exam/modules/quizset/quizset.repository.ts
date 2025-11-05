import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/common/repositories/base.repository';
import { PrismaService } from 'src/prisma/prisma.service';
import { RedisService } from 'src/packages/redis/redis.service';
import { QuizSet } from '@prisma/client';
import { EXPIRED_TIME } from 'src/constants/redis';

@Injectable()
export class QuizSetRepository extends BaseRepository<QuizSet> {
    protected modelName = 'quizSet';
    protected cachePrefix = 'quizset';
    protected defaultCacheTTL = EXPIRED_TIME.FIVE_MINUTES;

    constructor(prisma: PrismaService, redis: RedisService) {
        super(prisma, redis);
    }

    /**
     * Tìm quiz set theo user ID với cache
     */
    async findByUserId(
        userId: string,
        cache = true,
        cacheTTL = this.defaultCacheTTL
    ): Promise<QuizSet[]> {
        return this.findAll({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            cache,
            cacheTTL,
        });
    }

    /**
     * Tìm public quiz sets
     */
    async findPublic(
        cache = true,
        cacheTTL = EXPIRED_TIME.TEN_MINUTES
    ): Promise<QuizSet[]> {
        return this.findAll({
            where: { isPublic: true },
            orderBy: { createdAt: 'desc' },
            cache,
            cacheTTL,
        });
    }

    /**
     * Tìm quiz set với questions
     */
    async findByIdWithQuestions(
        id: string,
        userId?: string,
        cache = true,
        cacheTTL = this.defaultCacheTTL
    ): Promise<any> {
        if (cache) {
            const cacheKey = this.getCacheKey(`id:${id}:questions`);
            const cached = await this.redis.get<any>(cacheKey);
            if (cached) return cached;
        }

        const where: any = { id };
        if (userId) {
            where.userId = userId;
        }

        const quizSet = await this.model.findUnique({
            where,
            include: {
                detailsQuizQuestions: {
                    include: {
                        quizQuestion: true,
                    },
                },
            },
        });

        if (quizSet && cache) {
            const cacheKey = this.getCacheKey(`id:${id}:questions`);
            await this.redis.set(cacheKey, quizSet, cacheTTL);
        }

        return quizSet;
    }

    /**
     * Tìm public quiz set by id
     */
    async findPublicById(
        id: string,
        cache = true,
        cacheTTL = EXPIRED_TIME.TEN_MINUTES
    ): Promise<any> {
        if (cache) {
            const cacheKey = this.getCacheKey(`public:${id}`);
            const cached = await this.redis.get<any>(cacheKey);
            if (cached) return cached;
        }

        const quizSet = await this.model.findUnique({
            where: { id, isPublic: true },
            include: {
                detailsQuizQuestions: {
                    include: {
                        quizQuestion: true,
                    },
                },
            },
        });

        if (quizSet && cache) {
            const cacheKey = this.getCacheKey(`public:${id}`);
            await this.redis.set(cacheKey, quizSet, cacheTTL);
        }

        return quizSet;
    }

    /**
     * Search quiz sets by title or tags
     */
    async search(
        query: string,
        userId?: string,
        onlyPublic = false,
        cache = true,
        cacheTTL = this.defaultCacheTTL
    ): Promise<QuizSet[]> {
        const where: any = {
            OR: [
                { title: { contains: query, mode: 'insensitive' } },
                { tags: { has: query } },
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
    async togglePin(id: string, userId: string): Promise<QuizSet> {
        const quizSet = await this.findOne({ where: { id, userId } });
        if (!quizSet) {
            throw new Error('Quiz set not found');
        }

        const updated = await this.update(
            id,
            { isPinned: !quizSet.isPinned },
            userId
        );

        // Invalidate cache
        await this.redis.del(this.getCacheKey(`id:${id}:questions`));

        return updated;
    }

    /**
     * Delete quiz set by user
     */
    async deleteByUser(id: string, userId: string): Promise<{ count: number }> {
        const result = await this.deleteMany({ id, userId });

        // Invalidate cache
        await this.invalidateCache();

        return result;
    }
}
