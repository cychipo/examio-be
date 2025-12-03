import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/common/repositories/base.repository';
import { PrismaService } from 'src/prisma/prisma.service';
import { RedisService } from 'src/packages/redis/redis.service';
import { QuizPracticeAttempt } from '@prisma/client';
import { EXPIRED_TIME } from 'src/constants/redis';

@Injectable()
export class QuizPracticeAttemptRepository extends BaseRepository<QuizPracticeAttempt> {
    protected modelName = 'quizPracticeAttempt';
    protected cachePrefix = 'quizpracticeattempt';
    protected defaultCacheTTL = EXPIRED_TIME.FIVE_MINUTES;

    constructor(prisma: PrismaService, redis: RedisService) {
        super(prisma, redis);
    }

    /**
     * Tìm attempt theo user, quizSet và type
     * Sử dụng unique constraint để query O(1)
     */
    async findByUserQuizSetAndType(
        userId: string,
        quizSetId: string,
        type: number,
        cache = true,
        cacheTTL = this.defaultCacheTTL
    ): Promise<QuizPracticeAttempt | null> {
        const cacheKey = `${this.cachePrefix}:unique:${userId}:${quizSetId}:${type}`;

        if (cache) {
            const cached = await this.redis.get<QuizPracticeAttempt>(cacheKey);
            if (cached) return cached;
        }

        const result = await (this.prisma as any)[this.modelName].findUnique({
            where: {
                quizSetId_userId_type: {
                    quizSetId,
                    userId,
                    type,
                },
            },
        });

        if (result && cache) {
            await this.redis.set(cacheKey, result, cacheTTL);
        }

        return result;
    }

    /**
     * Tìm tất cả attempts của user
     */
    async findByUserId(
        userId: string,
        cache = true,
        cacheTTL = this.defaultCacheTTL
    ): Promise<QuizPracticeAttempt[]> {
        return this.findAll({
            where: { userId },
            orderBy: { updatedAt: 'desc' },
            cache,
            cacheTTL,
        });
    }

    /**
     * Tìm attempt gần nhất của user cho quizSet (bất kỳ type nào)
     */
    async findLatestByUserAndQuizSet(
        userId: string,
        quizSetId: string,
        cache = true,
        cacheTTL = this.defaultCacheTTL
    ): Promise<QuizPracticeAttempt | null> {
        const results = await this.findAll({
            where: { userId, quizSetId },
            orderBy: { updatedAt: 'desc' },
            take: 1,
            cache,
            cacheTTL,
        });
        return results[0] || null;
    }

    /**
     * Lấy danh sách latest attempts cho tất cả quizSets của user
     * Optimized query sử dụng raw SQL với DISTINCT ON
     */
    async findLatestAttemptsForQuizSets(
        userId: string,
        quizSetIds: string[]
    ): Promise<QuizPracticeAttempt[]> {
        if (quizSetIds.length === 0) return [];

        // Sử dụng Prisma raw query với DISTINCT ON để lấy bản ghi mới nhất cho mỗi quizSetId
        // Điều này cho phép O(n) thay vì O(n*m) queries
        const results = await this.prisma.$queryRaw<QuizPracticeAttempt[]>`
            SELECT DISTINCT ON ("quizSetId") *
            FROM "QuizPracticeAttempt"
            WHERE "userId" = ${userId}
            AND "quizSetId" = ANY(${quizSetIds}::text[])
            ORDER BY "quizSetId", "updatedAt" DESC
        `;

        return results;
    }

    /**
     * Tính tỷ lệ hoàn thành trung bình của user
     * Chỉ tính các bài đã submit
     */
    async getAverageCompletionRate(userId: string): Promise<number> {
        const result = await this.prisma.$queryRaw<
            [{ avg_rate: number | null }]
        >`
            SELECT
                ROUND(
                    AVG(
                        CASE
                            WHEN "totalQuestions" > 0
                            THEN (CAST("correctAnswers" AS DECIMAL) / "totalQuestions") * 100
                            ELSE 0
                        END
                    )::numeric,
                    1
                ) as avg_rate
            FROM "QuizPracticeAttempt"
            WHERE "userId" = ${userId}
            AND "isSubmitted" = true
            AND "totalQuestions" > 0
        `;

        return result[0]?.avg_rate ?? 0;
    }

    /**
     * Override update để invalidate unique cache key
     */
    async update(
        id: string,
        data: Partial<QuizPracticeAttempt>,
        userId?: string
    ): Promise<QuizPracticeAttempt> {
        // Lấy record hiện tại để biết cache keys cần invalidate
        const existing = await (this.prisma as any)[this.modelName].findUnique({
            where: { id },
        });

        const result = await super.update(id, data, userId);

        // Invalidate unique cache key
        if (existing) {
            const uniqueCacheKey = `${this.cachePrefix}:unique:${existing.userId}:${existing.quizSetId}:${existing.type}`;
            await this.redis.del(uniqueCacheKey);
        }

        return result;
    }

    /**
     * Override delete để invalidate unique cache key
     */
    async delete(id: string, userId?: string): Promise<QuizPracticeAttempt> {
        const existing = await (this.prisma as any)[this.modelName].findUnique({
            where: { id },
        });

        const result = await super.delete(id, userId);

        if (existing) {
            const uniqueCacheKey = `${this.cachePrefix}:unique:${existing.userId}:${existing.quizSetId}:${existing.type}`;
            await this.redis.del(uniqueCacheKey);
        }

        return result;
    }
}
