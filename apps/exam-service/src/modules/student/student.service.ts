import { Injectable } from '@nestjs/common';
import { PrismaService } from '@examio/database';

@Injectable()
export class StudentService {
    constructor(private readonly prisma: PrismaService) {}

    async getRecentFlashcards(userId: string, limit: number) {
        // Get flashcard sets the student has access to
        // This includes public sets and sets they've been granted access to
        const flashcardSets = await this.prisma.flashCardSet.findMany({
            where: {
                OR: [
                    { isPublic: true },
                    { userId: userId },
                    { whitelist: { has: userId } },
                ],
            },
            include: {
                user: {
                    select: {
                        id: true,
                        username: true,
                        name: true,
                        avatar: true,
                    },
                },
                detailsFlashCard: {
                    select: {
                        id: true,
                    },
                },
            },
            orderBy: {
                updatedAt: 'desc',
            },
            take: limit,
        });

        const formattedSets = flashcardSets.map((set) => ({
            id: set.id,
            title: set.title,
            description: set.description,
            thumbnail: set.thumbnail,
            viewCount: set.viewCount,
            flashcardCount: set.detailsFlashCard.length,
            lastViewedAt: set.updatedAt.toISOString(),
            createdAt: set.createdAt.toISOString(),
            creator: {
                id: set.user.id,
                username: set.user.username,
                name: set.user.name,
                avatar: set.user.avatar,
            },
            isPublic: set.isPublic,
            progress: undefined, // TODO: Implement progress tracking
        }));

        return {
            flashcardSets: formattedSets,
            total: formattedSets.length,
        };
    }

    async getRecentExams(userId: string, limit: number) {
        // Get exam attempts from exam rooms
        const examAttempts = await this.prisma.examAttempt.findMany({
            where: {
                userId,
            },
            include: {
                examSession: {
                    include: {
                        examRoom: {
                            select: {
                                id: true,
                                title: true,
                                description: true,
                            },
                        },
                    },
                },
            },
            orderBy: {
                createdAt: 'desc',
            },
            take: limit,
        });

        // Get practice attempts
        const practiceAttempts = await this.prisma.quizPracticeAttempt.findMany({
            where: {
                userId,
            },
            include: {
                quizSet: {
                    select: {
                        id: true,
                        title: true,
                        description: true,
                        thumbnail: true,
                    },
                },
            },
            orderBy: {
                createdAt: 'desc',
            },
            take: limit,
        });

        const formattedExamAttempts = examAttempts.map((attempt) => {
            const timeLimitMinutes = attempt.examSession.timeLimitMinutes;
            let timeRemaining = null;

            if (attempt.status === 0 && timeLimitMinutes) {
                // IN_PROGRESS
                const startedAt = new Date(attempt.startedAt).getTime();
                const now = Date.now();
                const elapsedMinutes = (now - startedAt) / (1000 * 60);
                timeRemaining = Math.max(0, timeLimitMinutes - elapsedMinutes);
            }

            return {
                id: attempt.id,
                examSessionId: attempt.examSessionId,
                score: attempt.score,
                violationCount: attempt.violationCount,
                startedAt: attempt.startedAt.toISOString(),
                finishedAt: attempt.finishedAt?.toISOString() || null,
                status: attempt.status,
                totalQuestions: attempt.totalQuestions,
                correctAnswers: attempt.correctAnswers,
                timeRemaining,
                examSession: {
                    id: attempt.examSession.id,
                    startTime: attempt.examSession.startTime.toISOString(),
                    endTime: attempt.examSession.endTime?.toISOString() || null,
                    timeLimitMinutes: attempt.examSession.timeLimitMinutes,
                    showAnswersAfterSubmit: attempt.examSession.showAnswersAfterSubmit,
                    examRoom: attempt.examSession.examRoom,
                },
            };
        });

        const formattedPracticeAttempts = practiceAttempts.map((attempt) => ({
            id: attempt.id,
            quizSetId: attempt.quizSetId,
            type: attempt.type,
            isSubmitted: attempt.isSubmitted,
            score: attempt.score,
            totalQuestions: attempt.totalQuestions,
            correctAnswers: attempt.correctAnswers,
            timeSpentSeconds: attempt.timeSpentSeconds,
            timeLimitMinutes: attempt.timeLimitMinutes,
            startedAt: attempt.createdAt.toISOString(),
            submittedAt: attempt.submittedAt?.toISOString() || null,
            quizSet: attempt.quizSet,
        }));

        return {
            examAttempts: formattedExamAttempts,
            practiceAttempts: formattedPracticeAttempts,
            total: formattedExamAttempts.length + formattedPracticeAttempts.length,
        };
    }
}
