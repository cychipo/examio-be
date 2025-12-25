import { Injectable } from '@nestjs/common';
import { PrismaService } from '@examio/database';
import { RedisService, EXPIRED_TIME } from '@examio/redis';
import { BaseRepository } from '@examio/common';
import { QuizSet } from '@prisma/client';

@Injectable()
export class QuizSetRepository extends BaseRepository<QuizSet> {
    protected modelName = 'quizSet';
    protected cachePrefix = 'quizset';
    protected defaultCacheTTL = EXPIRED_TIME.FIVE_MINUTES;

    constructor(prisma: PrismaService, redis: RedisService) {
        super(prisma, redis);
    }

    // ==================== CUSTOM METHODS ====================

    /**
     * Tìm quiz set theo user ID
     */
    async findByUserId(userId: string, cache = true): Promise<QuizSet[]> {
        const cacheKey = this.getCacheKey(`user:${userId}:list`);

        if (cache) {
            const cached = await this.redis.get<QuizSet[]>(cacheKey);
            if (cached) return cached;
        }

        const data = await this.model.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
        });

        if (cache) {
            await this.redis.set(cacheKey, data, this.defaultCacheTTL);
        }
        return data;
    }

    /**
     * Tìm public quiz sets
     */
    async findPublic(cache = true): Promise<QuizSet[]> {
        const cacheKey = this.getCacheKey('public:list');

        if (cache) {
            const cached = await this.redis.get<QuizSet[]>(cacheKey);
            if (cached) return cached;
        }

        const data = await this.model.findMany({
            where: { isPublic: true },
            orderBy: { createdAt: 'desc' },
        });

        if (cache) {
            await this.redis.set(cacheKey, data, EXPIRED_TIME.TEN_MINUTES);
        }
        return data;
    }

    /**
     * Tìm quiz set với questions
     */
    async findByIdWithQuestions(
        id: string,
        userId?: string,
        cache = true
    ): Promise<any> {
        const cacheKey = this.getCacheKey(`id:${id}:questions`);

        if (cache) {
            const cached = await this.redis.get<any>(cacheKey);
            if (cached) return cached;
        }

        const where: any = { id };
        if (userId) where.userId = userId;

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
            await this.redis.set(cacheKey, quizSet, this.defaultCacheTTL);
        }
        return quizSet;
    }

    /**
     * Tìm public quiz set by id
     */
    async findPublicById(id: string, cache = true): Promise<any> {
        const cacheKey = this.getCacheKey(`public:${id}`);

        if (cache) {
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
            await this.redis.set(cacheKey, quizSet, EXPIRED_TIME.TEN_MINUTES);
        }
        return quizSet;
    }

    /**
     * Search quiz sets
     */
    async search(
        query: string,
        userId?: string,
        onlyPublic = false
    ): Promise<QuizSet[]> {
        const where: any = {
            OR: [
                { title: { contains: query, mode: 'insensitive' } },
                { tags: { has: query } },
            ],
        };

        if (userId) where.userId = userId;
        if (onlyPublic) where.isPublic = true;

        return this.model.findMany({
            where,
            orderBy: { createdAt: 'desc' },
        });
    }

    /**
     * Toggle pin status
     */
    async togglePin(id: string, userId: string): Promise<QuizSet> {
        const quizSet = await this.model.findUnique({ where: { id, userId } });
        if (!quizSet) throw new Error('Quiz set not found');

        return this.update(id, { isPinned: !quizSet.isPinned }, userId);
    }
}
