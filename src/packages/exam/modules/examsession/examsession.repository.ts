import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/common/repositories/base.repository';
import { PrismaService } from 'src/prisma/prisma.service';
import { RedisService } from 'src/packages/redis/redis.service';
import { ExamSession } from '@prisma/client';
import { EXPIRED_TIME } from 'src/constants/redis';

@Injectable()
export class ExamSessionRepository extends BaseRepository<ExamSession> {
    protected modelName = 'examSession';
    protected cachePrefix = 'examsession';
    protected defaultCacheTTL = EXPIRED_TIME.FIVE_MINUTES;

    constructor(prisma: PrismaService, redis: RedisService) {
        super(prisma, redis);
    }

    /**
     * Tìm exam sessions theo exam room ID
     */
    async findByExamRoomId(
        examRoomId: string,
        cache = true,
        cacheTTL = this.defaultCacheTTL
    ): Promise<ExamSession[]> {
        return this.findAll({
            where: { examRoomId },
            orderBy: { startTime: 'desc' },
            cache,
            cacheTTL,
        });
    }

    /**
     * Tìm ongoing sessions
     */
    async findOngoing(
        cache = true,
        cacheTTL = EXPIRED_TIME.ONE_MINUTE
    ): Promise<ExamSession[]> {
        return this.findAll({
            where: { status: 1 }, // 1: ONGOING
            orderBy: { startTime: 'desc' },
            cache,
            cacheTTL,
        });
    }

    /**
     * Tìm exam session với participants và attempts
     */
    async findByIdWithDetails(
        id: string,
        cache = true,
        cacheTTL = this.defaultCacheTTL
    ): Promise<any> {
        if (cache) {
            const cacheKey = this.getCacheKey(`id:${id}:details`);
            const cached = await this.redis.get<any>(cacheKey);
            if (cached) return cached;
        }

        const examSession = await this.model.findUnique({
            where: { id },
            include: {
                examRoom: {
                    include: {
                        quizSet: true,
                        host: {
                            select: {
                                id: true,
                                username: true,
                                email: true,
                                avatar: true,
                            },
                        },
                    },
                },
                participants: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                username: true,
                                email: true,
                                avatar: true,
                            },
                        },
                    },
                },
                examAttempts: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                username: true,
                                email: true,
                                avatar: true,
                            },
                        },
                    },
                },
            },
        });

        if (examSession && cache) {
            const cacheKey = this.getCacheKey(`id:${id}:details`);
            await this.redis.set(cacheKey, examSession, cacheTTL);
        }

        return examSession;
    }

    /**
     * Update status và invalidate cache
     */
    async updateStatus(id: string, status: number): Promise<ExamSession> {
        const updated = await this.update(id, { status });

        // Invalidate specific caches
        await this.redis.del(this.getCacheKey(`id:${id}:details`));
        // Only invalidate ongoing cache pattern, not all cache
        if (status === 1) {
            // If status is ONGOING, others might need updated list
            await this.redis.delPattern(`${this.cachePrefix}:ongoing:*`);
        }

        return updated;
    }
}
