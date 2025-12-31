import { Injectable } from '@nestjs/common';
import { BaseRepository } from '@examio/common';
import { PrismaService } from '@examio/database';
import { RedisService, EXPIRED_TIME } from '@examio/redis';
import { ExamRoom } from '@prisma/client';

@Injectable()
export class ExamRoomRepository extends BaseRepository<ExamRoom> {
    protected modelName = 'examRoom';
    protected cachePrefix = 'examroom';
    protected defaultCacheTTL = EXPIRED_TIME.FIVE_MINUTES;

    constructor(prisma: PrismaService, redis: RedisService) {
        super(prisma, redis);
    }

    /**
     * Tìm exam rooms theo host ID
     */
    async findByHostId(
        hostId: string,
        cache = true,
        cacheTTL = this.defaultCacheTTL
    ): Promise<ExamRoom[]> {
        return this.findAll({
            where: { hostId },
            orderBy: { createdAt: 'desc' },
            cache,
            cacheTTL,
        });
    }

    /**
     * Tìm public exam rooms
     */
    async findPublic(
        cache = true,
        cacheTTL = EXPIRED_TIME.TEN_MINUTES
    ): Promise<ExamRoom[]> {
        return this.findAll({
            where: { assessType: 0 }, // 0: PUBLIC
            orderBy: { createdAt: 'desc' },
            cache,
            cacheTTL,
        });
    }

    /**
     * Tìm exam room với sessions
     */
    async findByIdWithSessions(
        id: string,
        cache = true,
        cacheTTL = this.defaultCacheTTL
    ): Promise<any> {
        if (cache) {
            const cacheKey = this.getCacheKey(`id:${id}:sessions`);
            const cached = await this.redis.get<any>(cacheKey);
            if (cached) return cached;
        }

        const examRoom = await this.model.findUnique({
            where: { id },
            include: {
                examSessions: {
                    orderBy: { startTime: 'desc' },
                },
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
        });

        if (examRoom && cache) {
            const cacheKey = this.getCacheKey(`id:${id}:sessions`);
            await this.redis.set(cacheKey, examRoom, cacheTTL);
        }

        return examRoom;
    }

    /**
     * Search exam rooms
     */
    async search(
        query: string,
        onlyPublic = false,
        cache = true,
        cacheTTL = this.defaultCacheTTL
    ): Promise<ExamRoom[]> {
        const where: any = {
            OR: [
                { title: { contains: query, mode: 'insensitive' } },
                { description: { contains: query, mode: 'insensitive' } },
            ],
        };

        if (onlyPublic) {
            where.assessType = 0;
        }

        return this.findAll({
            where,
            orderBy: { createdAt: 'desc' },
            cache,
            cacheTTL,
        });
    }
}
