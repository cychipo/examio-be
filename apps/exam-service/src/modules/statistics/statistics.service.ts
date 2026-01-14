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
        const cacheKey = `statistics:teacher:${user.id}:${range}`;
        
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

            // Cache for 1 minute instead of 10 during debug/initial phase
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
        const examAttempts = await this.prisma.examAttempt.findMany({
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
        });

        const practiceAttempts = await this.prisma.quizPracticeAttempt.findMany({
            where: {
                quizSet: {
                    userId: userId
                },
                createdAt: {
                    gte: startDate,
                    lte: endDate,
                }
            },
            select: { createdAt: true }
        });

        return intervalDays.map(day => {
            const dayStr = format(day, 'dd/MM');
            return {
                day: dayStr,
                examAttempts: examAttempts.filter(a => format(a.createdAt, 'dd/MM') === dayStr).length,
                practiceAttempts: practiceAttempts.filter(a => format(a.createdAt, 'dd/MM') === dayStr).length,
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
        const cacheKey = `statistics:student:${user.id}:${range}`;

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

            // Cache for 10 minutes
            await this.redisService.set(cacheKey, result, 600);

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

        // Get practice attempts
        const practiceAttempts = await this.prisma.quizPracticeAttempt.findMany({
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
                examAttempts: examAttempts.filter(a => format(a.createdAt, 'dd/MM') === dayStr).length,
                practiceAttempts: practiceAttempts.filter(a => format(a.createdAt, 'dd/MM') === dayStr).length,
            };
        });
    }

    private async getStudentFlashcardStats(userId: string, intervalDays: Date[], startDate: Date, endDate: Date) {
        // Since we don't have a FlashCardPracticeAttempt table,
        // we'll use FlashCardSet viewCount increments as a proxy
        // For now, we'll create a simplified version based on the data we have

        // We can track flashcard views by checking when user accessed flashcard sets
        // If there's no tracking table, we'll return estimated data based on available info
        // This is a placeholder - in production, you'd want to implement proper tracking

        const flashcardSets = await this.prisma.flashCardSet.findMany({
            where: {
                userId: { not: userId }, // Sets created by others that this user might have viewed
                isPublic: true,
            },
            select: {
                id: true,
                viewCount: true,
                updatedAt: true,
            },
        });

        // For now, return daily counts based on interval
        // This is simplified - ideally you'd have a FlashCardViewHistory table
        return intervalDays.map(day => {
            const dayStr = format(day, 'dd/MM');
            // Placeholder: distribute views evenly or return 0
            // In production, implement proper view tracking
            return {
                day: dayStr,
                viewCount: 0, // TODO: Implement proper flashcard view tracking
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

        // Also get practice attempts
        const recentPractice = await this.prisma.quizPracticeAttempt.findMany({
            where: {
                userId,
                isSubmitted: true,
            },
            orderBy: {
                updatedAt: 'desc',
            },
            take: limit,
            select: {
                score: true,
                updatedAt: true,
            },
        });

        // Combine and sort by date
        const combined = [
            ...recentAttempts
                .filter(a => a.score !== null && a.finishedAt !== null)
                .map(a => ({
                    score: a.score,
                    date: a.finishedAt,
                })),
            ...recentPractice
                .filter(a => a.score !== null)
                .map(a => ({
                    score: a.score || 0,
                    date: a.updatedAt,
                })),
        ].sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, limit);

        return combined.map(item => ({
            day: format(item.date, 'dd/MM HH:mm'),
            score: item.score,
        }));
    }

    private async getStudentSummaryTotals(userId: string, startDate: Date, endDate: Date) {
        // Get counts for the selected range
        const [examCount, practiceCount] = await Promise.all([
            this.prisma.examAttempt.count({
                where: {
                    userId,
                    createdAt: {
                        gte: startDate,
                        lte: endDate,
                    },
                },
            }),
            this.prisma.quizPracticeAttempt.count({
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

        const completedPractice = await this.prisma.quizPracticeAttempt.findMany({
            where: {
                userId,
                isSubmitted: true,
                createdAt: {
                    gte: startDate,
                    lte: endDate,
                },
            },
            select: { score: true },
        });

        const allScores = [
            ...completedExams.map(e => e.score),
            ...completedPractice.map(p => p.score || 0),
        ].filter(score => score !== null && score !== undefined);

        const averageScore = allScores.length > 0
            ? allScores.reduce((sum, score) => sum + score, 0) / allScores.length
            : 0;

        // For flashcard views, return 0 for now until proper tracking is implemented
        const flashcardViews = 0;

        return {
            totalExamAttempts: examCount,
            totalPracticeAttempts: practiceCount,
            totalFlashcardViews: flashcardViews,
            averageScore: Math.round(averageScore * 10) / 10,
        };
    }
}
