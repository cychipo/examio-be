import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import {
    CHEATING_TYPE,
    CHEATING_TYPE_DESCRIPTIONS,
} from './dto/create-cheatinglog.dto';

@Injectable()
export class CheatingLogRepository {
    constructor(private readonly prisma: PrismaService) {}

    /**
     * Upsert cheating log - increment count if exists, create if not
     * O(1) lookup with unique constraint on [examAttemptId, type]
     */
    async upsertCheatingLog(examAttemptId: string, type: CHEATING_TYPE) {
        const description = CHEATING_TYPE_DESCRIPTIONS[type];

        return this.prisma.cheatingLog.upsert({
            where: {
                examAttemptId_type: {
                    examAttemptId,
                    type,
                },
            },
            create: {
                examAttemptId,
                type,
                description,
                count: 1,
                lastOccurredAt: new Date(),
            },
            update: {
                count: { increment: 1 },
                lastOccurredAt: new Date(),
            },
        });
    }

    /**
     * Get all cheating logs for an attempt
     */
    async getByAttemptId(examAttemptId: string) {
        return this.prisma.cheatingLog.findMany({
            where: { examAttemptId },
            orderBy: { lastOccurredAt: 'desc' },
        });
    }

    /**
     * Get cheating stats for a session - aggregated by type
     */
    async getSessionStats(examSessionId: string) {
        const stats = await this.prisma.cheatingLog.groupBy({
            by: ['type'],
            where: {
                examAttempt: {
                    examSessionId,
                },
            },
            _sum: {
                count: true,
            },
            _count: {
                examAttemptId: true,
            },
        });

        return stats.map((s) => ({
            type: s.type,
            description:
                CHEATING_TYPE_DESCRIPTIONS[s.type as CHEATING_TYPE] || s.type,
            totalCount: s._sum.count || 0,
            affectedAttempts: s._count.examAttemptId,
        }));
    }

    /**
     * Get total violation count for an attempt
     */
    async getTotalViolationCount(examAttemptId: string): Promise<number> {
        const result = await this.prisma.cheatingLog.aggregate({
            where: { examAttemptId },
            _sum: { count: true },
        });
        return result._sum.count || 0;
    }
}
