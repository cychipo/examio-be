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

    /**
     * Get all attempts for a user in a session with their cheating logs
     * Single query to avoid N+1 problem
     */
    async getUserAttemptsWithLogs(
        sessionId: string,
        userId: string
    ): Promise<{
        attempts: Array<{
            id: string;
            status: number;
            score: number;
            totalQuestions: number;
            correctAnswers: number;
            startedAt: Date;
            finishedAt: Date | null;
            violationCount: number;
            timeSpentSeconds: number;
            cheatingLogs: Array<{
                id: string;
                type: string;
                description: string;
                count: number;
                lastOccurredAt: Date;
            }>;
        }>;
        aggregatedLogs: Array<{
            type: string;
            description: string;
            totalCount: number;
        }>;
    }> {
        // Get all attempts for this user in this session
        const attempts = await this.prisma.examAttempt.findMany({
            where: {
                examSessionId: sessionId,
                userId: userId,
            },
            select: {
                id: true,
                status: true,
                score: true,
                totalQuestions: true,
                correctAnswers: true,
                startedAt: true,
                finishedAt: true,
                violationCount: true,
                cheatingLogs: {
                    orderBy: { lastOccurredAt: 'desc' },
                },
            },
            orderBy: { startedAt: 'desc' },
        });

        // Calculate time spent for each attempt
        const attemptsWithTime = attempts.map((attempt) => {
            const start = new Date(attempt.startedAt).getTime();
            const end = attempt.finishedAt
                ? new Date(attempt.finishedAt).getTime()
                : Date.now();
            const timeSpentSeconds = Math.floor((end - start) / 1000);

            return {
                id: attempt.id,
                status: attempt.status,
                score: attempt.score,
                totalQuestions: attempt.totalQuestions,
                correctAnswers: attempt.correctAnswers,
                startedAt: attempt.startedAt,
                finishedAt: attempt.finishedAt,
                violationCount: attempt.violationCount,
                timeSpentSeconds,
                cheatingLogs: attempt.cheatingLogs.map((log) => ({
                    id: log.id,
                    type: log.type,
                    description:
                        CHEATING_TYPE_DESCRIPTIONS[log.type as CHEATING_TYPE] ||
                        log.type,
                    count: log.count,
                    lastOccurredAt: log.lastOccurredAt,
                })),
            };
        });

        // Aggregate logs across all attempts
        const logsMap = new Map<
            string,
            { type: string; description: string; totalCount: number }
        >();
        for (const attempt of attempts) {
            for (const log of attempt.cheatingLogs) {
                const existing = logsMap.get(log.type);
                if (existing) {
                    existing.totalCount += log.count;
                } else {
                    logsMap.set(log.type, {
                        type: log.type,
                        description:
                            CHEATING_TYPE_DESCRIPTIONS[
                                log.type as CHEATING_TYPE
                            ] || log.type,
                        totalCount: log.count,
                    });
                }
            }
        }

        return {
            attempts: attemptsWithTime,
            aggregatedLogs: Array.from(logsMap.values()),
        };
    }
}
