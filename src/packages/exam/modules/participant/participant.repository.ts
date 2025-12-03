import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/common/repositories/base.repository';
import { PrismaService } from 'src/prisma/prisma.service';
import { RedisService } from 'src/packages/redis/redis.service';
import { ExamSessionParticipant } from '@prisma/client';
import { EXPIRED_TIME } from 'src/constants/redis';

@Injectable()
export class ParticipantRepository extends BaseRepository<ExamSessionParticipant> {
    protected modelName = 'examSessionParticipant';
    protected cachePrefix = 'participant';
    protected defaultCacheTTL = EXPIRED_TIME.FIVE_MINUTES;

    constructor(prisma: PrismaService, redis: RedisService) {
        super(prisma, redis);
    }

    /**
     * Tìm participants theo exam session ID
     */
    async findByExamSessionId(
        examSessionId: string,
        cache = true,
        cacheTTL = this.defaultCacheTTL
    ): Promise<ExamSessionParticipant[]> {
        if (cache) {
            const cacheKey = this.getCacheKey(`session:${examSessionId}`);
            const cached =
                await this.redis.get<ExamSessionParticipant[]>(cacheKey);
            if (cached) return cached;
        }

        const participants = await this.model.findMany({
            where: { examSessionId },
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
            orderBy: { joinedAt: 'desc' },
        });

        if (cache) {
            const cacheKey = this.getCacheKey(`session:${examSessionId}`);
            await this.redis.set(cacheKey, participants, cacheTTL);
        }

        return participants;
    }

    /**
     * Tìm participant cụ thể
     */
    async findByUserAndSession(
        userId: string,
        examSessionId: string,
        cache = true,
        cacheTTL = this.defaultCacheTTL
    ): Promise<ExamSessionParticipant | null> {
        return this.findOne({
            where: {
                userId,
                examSessionId,
            },
            cache,
            cacheTTL,
        });
    }

    /**
     * Approve participant
     */
    async approve(
        id: string,
        sessionId?: string
    ): Promise<ExamSessionParticipant> {
        const updated = await this.update(id, {
            status: 1, // 1: APPROVED
            joinedAt: new Date(),
        });

        // Invalidate session-specific cache if sessionId provided
        if (sessionId) {
            await this.redis.del(this.getCacheKey(`session:${sessionId}`));
        }

        return updated;
    }

    /**
     * Reject participant
     */
    async reject(
        id: string,
        sessionId?: string
    ): Promise<ExamSessionParticipant> {
        const updated = await this.update(id, {
            status: 2, // 2: REJECTED
        });

        // Invalidate session-specific cache if sessionId provided
        if (sessionId) {
            await this.redis.del(this.getCacheKey(`session:${sessionId}`));
        }

        return updated;
    }

    /**
     * Leave session
     */
    async leave(
        id: string,
        sessionId?: string
    ): Promise<ExamSessionParticipant> {
        // BaseRepository.update() handles cache invalidation
        const updated = await this.update(id, {
            status: 3, // 3: LEFT
            leftAt: new Date(),
        });

        // Invalidate session-specific cache if sessionId provided
        if (sessionId) {
            await this.redis.del(this.getCacheKey(`session:${sessionId}`));
        }

        return updated;
    }
}
