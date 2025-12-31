import { Injectable } from '@nestjs/common';
import { BaseRepository } from '@examio/common';
import { PrismaService } from '@examio/database';
import { RedisService, EXPIRED_TIME } from '@examio/redis';
import { ExamAttempt } from '@prisma/client';

@Injectable()
export class ExamAttemptRepository extends BaseRepository<ExamAttempt> {
    protected modelName = 'examAttempt';
    protected cachePrefix = 'examattempt';
    protected defaultCacheTTL = EXPIRED_TIME.FIVE_MINUTES;

    constructor(prisma: PrismaService, redis: RedisService) {
        super(prisma, redis);
    }

    /**
     * Tìm exam attempts theo user ID
     */
    async findByUserId(
        userId: string,
        cache = true,
        cacheTTL = this.defaultCacheTTL
    ): Promise<ExamAttempt[]> {
        return this.findAll({
            where: { userId },
            orderBy: { startedAt: 'desc' },
            cache,
            cacheTTL,
        });
    }

    /**
     * Tìm exam attempts theo exam session ID
     */
    async findByExamSessionId(
        examSessionId: string,
        cache = true,
        cacheTTL = this.defaultCacheTTL
    ): Promise<ExamAttempt[]> {
        return this.findAll({
            where: { examSessionId },
            orderBy: { startedAt: 'desc' },
            cache,
            cacheTTL,
        });
    }

    /**
     * Tìm exam attempt của user trong session cụ thể
     */
    async findByUserAndSession(
        userId: string,
        examSessionId: string,
        cache = true,
        cacheTTL = this.defaultCacheTTL
    ): Promise<ExamAttempt[]> {
        return this.findAll({
            where: {
                userId,
                examSessionId,
            },
            orderBy: { startedAt: 'desc' },
            cache,
            cacheTTL,
        });
    }

    /**
     * Count attempts của user trong session
     */
    async countUserAttempts(
        userId: string,
        examSessionId: string
    ): Promise<number> {
        return this.count({
            userId,
            examSessionId,
        });
    }

    /**
     * Tìm in-progress attempts của user
     */
    async findInProgressByUser(
        userId: string,
        cache = false
    ): Promise<ExamAttempt[]> {
        return this.findAll({
            where: {
                userId,
                status: 0, // 0: IN_PROGRESS
            },
            orderBy: { startedAt: 'desc' },
            cache,
        });
    }

    /**
     * Update score và finish attempt
     */
    async finishAttempt(
        id: string,
        score: number,
        violationCount: number,
        userId?: string
    ): Promise<ExamAttempt> {
        // BaseRepository.update() handles cache invalidation automatically
        return this.update(
            id,
            {
                score,
                violationCount,
                finishedAt: new Date(),
                status: 1, // 1: COMPLETED
            },
            userId
        );
    }
}
