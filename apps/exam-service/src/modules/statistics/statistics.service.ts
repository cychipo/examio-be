import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '@examio/database';
import { RedisService, EXPIRED_TIME } from '@examio/redis';
import { User } from '@prisma/client';
import { startOfWeek, endOfWeek, eachDayOfInterval, format, subWeeks, subDays, startOfDay, endOfDay } from 'date-fns';

@Injectable()
export class StatisticsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly redisService: RedisService,
    ) {}

    async getTeacherDashboardStats(user: User, range: '7d' | '30d' = '7d') {
        const cacheKey = `statistics:v2:teacher:${user.id}:${range}`;
        
        // Try to get from cache
        const cachedData = await this.redisService.get(cacheKey);
        if (cachedData) {
            return cachedData;
        }

        try {
            const now = new Date();
            let startDate: Date;
            
            if (range === '30d') {
                startDate = startOfDay(subDays(now, 29));
            } else {
                startDate = startOfDay(subDays(now, 6));
            }

            const endDate = endOfDay(now);

            const intervalDays = eachDayOfInterval({
                start: startDate,
                end: now,
            });

            // 1. Creation Stats
            const creationStats = await this.getCreationStats(user.id, intervalDays, startDate, endDate);

            // 2. Activity Stats
            const activityStats = await this.getActivityStats(user.id, intervalDays, startDate, endDate);

            // 3. Top 5 Rooms by Participants
            const topRoomsByParticipants = await this.getTopRoomsByParticipants(user.id);

            // 4. Top 5 Rooms by Average Score
            const topRoomsByAvgScore = await this.getTopRoomsByAvgScore(user.id);

            // 5. Top 5 Flashcard Sets by View Count
            const topFlashcardSets = await this.getTopFlashcardSets(user.id);

            // 6. Summary Totals
            const summary = await this.getSummaryTotals(user.id);

            const result = {
                creationStats,
                activityStats,
                topRoomsByParticipants,
                topRoomsByAvgScore,
                topFlashcardSets,
                summary,
                updatedAt: now.toISOString(),
            };

            // Cache for 1 minute during verification phase
            await this.redisService.set(cacheKey, result, 60); 

            return result;
        } catch (error) {
            console.error('Error fetching teacher stats:', error);
            throw new InternalServerErrorException('Không thể lấy dữ liệu thống kê');
        }
    }

    private async getCreationStats(userId: string, intervalDays: Date[], startDate: Date, endDate: Date) {
        const quizSets = await this.prisma.quizSet.findMany({
            where: {
                userId,
                createdAt: {
                    gte: startDate,
                    lte: endDate,
                },
            },
            select: { createdAt: true },
        });

        const flashcardSets = await this.prisma.flashCardSet.findMany({
            where: {
                userId,
                createdAt: {
                    gte: startDate,
                    lte: endDate,
                },
            },
            select: { createdAt: true },
        });

        return intervalDays.map(day => {
            const dayStr = format(day, 'dd/MM');
            return {
                day: dayStr,
                quizSets: quizSets.filter(s => format(s.createdAt, 'dd/MM') === dayStr).length,
                flashcardSets: flashcardSets.filter(s => format(s.createdAt, 'dd/MM') === dayStr).length,
            };
        });
    }

    private async getActivityStats(userId: string, intervalDays: Date[], startDate: Date, endDate: Date) {
        // Exam attempts in rooms hosted by this teacher
        const [examAttempts, flashcardViews] = await Promise.all([
            this.prisma.examAttempt.findMany({
                where: {
                    examSession: {
                        examRoom: {
                            hostId: userId,
                        },
                    },
                    createdAt: {
                        gte: startDate,
                        lte: endDate,
                    },
                },
                select: { createdAt: true },
            }),
            this.prisma.flashCardViewHistory.findMany({
                where: {
                    flashCardSet: {
                        userId: userId,
                    },
                    viewedAt: {
                        gte: startDate,
                        lte: endDate,
                    },
                },
                select: { viewedAt: true },
            }),
        ]);

        return intervalDays.map(day => {
            const dayStr = format(day, 'dd/MM');
            return {
                day: dayStr,
                examAttempts: examAttempts.filter(a => {
                    const createdAt = a.createdAt instanceof Date ? a.createdAt : new Date(a.createdAt);
                    return format(createdAt, 'dd/MM') === dayStr;
                }).length,
                flashcardViews: flashcardViews.filter(v => {
                    const viewedAt = v.viewedAt instanceof Date ? v.viewedAt : new Date(v.viewedAt);
                    return format(viewedAt, 'dd/MM') === dayStr;
                }).length,
            };
        });
    }

    private async getTopRoomsByParticipants(userId: string) {
        const rooms = await this.prisma.examRoom.findMany({
            where: { hostId: userId },
            include: {
                _count: {
                    select: {
                        examSessions: true,
                    }
                },
                examSessions: {
                    include: {
                        _count: {
                            select: { examAttempts: true }
                        }
                    }
                }
            },
            take: 10, // Get more to manually aggregate if needed, but we'll stick to top 5
        });

        const roomStats = rooms.map(room => {
            const participantCount = room.examSessions.reduce((sum, session) => sum + session._count.examAttempts, 0);
            return {
                id: room.id,
                title: room.title,
                participants: participantCount,
            };
        });

        return roomStats.sort((a, b) => b.participants - a.participants).slice(0, 5);
    }

    private async getTopRoomsByAvgScore(userId: string) {
        const rooms = await this.prisma.examRoom.findMany({
            where: { hostId: userId },
            include: {
                examSessions: {
                    include: {
                        examAttempts: {
                            where: { status: 1 }, // COMPLETED
                            select: { score: true }
                        }
                    }
                }
            }
        });

        const roomStats = rooms.map(room => {
            let totalScore = 0;
            let count = 0;
            room.examSessions.forEach(session => {
                session.examAttempts.forEach(attempt => {
                    totalScore += attempt.score;
                    count++;
                });
            });

            return {
                id: room.id,
                title: room.title,
                avgScore: count > 0 ? Math.round((totalScore / count) * 10) / 10 : 0,
                count
            };
        }).filter(r => r.count > 0);

        return roomStats.sort((a, b) => b.avgScore - a.avgScore).slice(0, 5);
    }

    private async getTopFlashcardSets(userId: string) {
        return this.prisma.flashCardSet.findMany({
            where: { userId },
            orderBy: { viewCount: 'desc' },
            take: 5,
            select: {
                id: true,
                title: true,
                viewCount: true,
            }
        });
    }

    private async getSummaryTotals(userId: string) {
        const [quizCount, flashcardCount, roomCount] = await Promise.all([
            this.prisma.quizSet.count({ where: { userId } }),
            this.prisma.flashCardSet.count({ where: { userId } }),
            this.prisma.examRoom.count({ where: { hostId: userId } }),
        ]);

        return {
            totalQuizSets: quizCount,
            totalFlashcardSets: flashcardCount,
            totalExamRooms: roomCount,
        };
    }

    async getStudentDashboardStats(user: User, range: '7d' | '30d' = '7d') {
        const cacheKey = `statistics:v2:student:${user.id}:${range}`;

        // Try to get from cache
        const cachedData = await this.redisService.get(cacheKey);
        if (cachedData) {
            return cachedData;
        }

        try {
            const now = new Date();
            let startDate: Date;

            if (range === '30d') {
                startDate = startOfDay(subDays(now, 29));
            } else {
                startDate = startOfDay(subDays(now, 6));
            }

            const endDate = endOfDay(now);

            const intervalDays = eachDayOfInterval({
                start: startDate,
                end: now,
            });

            // 1. Exam Stats (both exam and practice attempts)
            const examStats = await this.getStudentExamStats(user.id, intervalDays, startDate, endDate);

            // 2. Flashcard Stats
            const flashcardStats = await this.getStudentFlashcardStats(user.id, intervalDays, startDate, endDate);

            // 3. Recent Scores (last 7 days)
            const recentScores = await this.getStudentRecentScores(user.id, range);

            // 4. Summary Totals
            const summary = await this.getStudentSummaryTotals(user.id, startDate, endDate);

            const result = {
                examStats,
                flashcardStats,
                recentScores,
                summary,
                updatedAt: now.toISOString(),
            };

            // Cache for 1 minute during verification phase
            await this.redisService.set(cacheKey, result, 60);

            return result;
        } catch (error) {
            console.error('Error fetching student stats:', error);
            throw new InternalServerErrorException('Không thể lấy dữ liệu thống kê');
        }
    }

    private async getStudentExamStats(userId: string, intervalDays: Date[], startDate: Date, endDate: Date) {
        // Get exam attempts (in exam rooms)
        const examAttempts = await this.prisma.examAttempt.findMany({
            where: {
                userId,
                createdAt: {
                    gte: startDate,
                    lte: endDate,
                },
            },
            select: { createdAt: true },
        });

        return intervalDays.map(day => {
            const dayStr = format(day, 'dd/MM');
            return {
                day: dayStr,
                examAttempts: examAttempts.filter(a => {
                    const createdAt = a.createdAt instanceof Date ? a.createdAt : new Date(a.createdAt);
                    return format(createdAt, 'dd/MM') === dayStr;
                }).length,
            };
        });
    }

    private async getStudentFlashcardStats(userId: string, intervalDays: Date[], startDate: Date, endDate: Date) {
        // Get flashcard view history and generation history for this user
        const [viewHistories, generationHistory] = await Promise.all([
            this.prisma.flashCardViewHistory.findMany({
                where: {
                    userId,
                    viewedAt: {
                        gte: startDate,
                        lte: endDate,
                    },
                },
                select: { viewedAt: true },
            }),
            this.prisma.historyGeneratedFlashcard.findMany({
                where: {
                    userId,
                    createdAt: {
                        gte: startDate,
                        lte: endDate,
                    },
                },
                select: { createdAt: true },
            }),
        ]);

        return intervalDays.map(day => {
            const dayStr = format(day, 'dd/MM');
            const views = viewHistories.filter(v => {
                const viewedAt = v.viewedAt instanceof Date ? v.viewedAt : new Date(v.viewedAt);
                return format(viewedAt, 'dd/MM') === dayStr;
            }).length;
            
            const gens = generationHistory.filter(g => {
                const createdAt = g.createdAt instanceof Date ? g.createdAt : new Date(g.createdAt);
                return format(createdAt, 'dd/MM') === dayStr;
            }).length;

            return {
                day: dayStr,
                viewCount: views + gens,
            };
        });
    }

    private async getStudentRecentScores(userId: string, range: '7d' | '30d') {
        const limit = range === '7d' ? 7 : 30;

        // Get recent completed exam attempts with scores
        const recentAttempts = await this.prisma.examAttempt.findMany({
            where: {
                userId,
                status: 1, // COMPLETED
            },
            orderBy: {
                finishedAt: 'desc',
            },
            take: limit,
            select: {
                score: true,
                finishedAt: true,
            },
        });

        // Combine and sort by date
        const combined = [
            ...recentAttempts
                .filter(a => a.score !== null && a.finishedAt !== null)
                .map(a => ({
                    score: a.score,
                    date: a.finishedAt!,
                })),
        ].sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, limit);

        return combined.map(item => ({
            day: format(item.date, 'dd/MM HH:mm'),
            score: item.score,
        }));
    }

    private async getStudentSummaryTotals(userId: string, startDate: Date, endDate: Date) {
        // Get counts for the selected range
        const [examCount, flashcardCount, generationCount] = await Promise.all([
            this.prisma.examAttempt.count({
                where: {
                    userId,
                    createdAt: {
                        gte: startDate,
                        lte: endDate,
                    },
                },
            }),
            this.prisma.flashCardViewHistory.count({
                where: {
                    userId,
                    viewedAt: {
                        gte: startDate,
                        lte: endDate,
                    },
                },
            }),
            this.prisma.historyGeneratedFlashcard.count({
                where: {
                    userId,
                    createdAt: {
                        gte: startDate,
                        lte: endDate,
                    },
                },
            }),
        ]);

        // Calculate average score from completed attempts
        const completedExams = await this.prisma.examAttempt.findMany({
            where: {
                userId,
                status: 1, // COMPLETED
                createdAt: {
                    gte: startDate,
                    lte: endDate,
                },
            },
            select: { score: true },
        });

        const allScores = [
            ...completedExams.map(e => e.score),
        ].filter(score => score !== null && score !== undefined);

        const averageScore = allScores.length > 0
            ? allScores.reduce((sum, score) => sum + score, 0) / allScores.length
            : 0;

        return {
            totalExamAttempts: examCount,
            totalFlashcardViews: flashcardCount + generationCount,
            averageScore: Math.round(averageScore * 10) / 10,
        };
    }
}
