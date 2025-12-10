import { PrismaService } from 'src/prisma/prisma.service';
import {
    Injectable,
    NotFoundException,
    InternalServerErrorException,
    ForbiddenException,
    BadRequestException,
} from '@nestjs/common';
import { GenerateIdService } from 'src/common/services/generate-id.service';
import { User } from '@prisma/client';
import { EXAM_SESSION_STATUS, EXAM_ATTEMPT_STATUS } from '../../types';
import { CreateExamAttemptDto } from './dto/create-examattempt.dto';
import { GetExamAttemptsDto } from './dto/get-examattempt.dto';
import { UpdateExamAttemptDto } from './dto/update-examattempt.dto';
import { ExamAttemptRepository } from './examattempt.repository';
import { ExamSessionRepository } from '../examsession/examsession.repository';
import { RedisService } from 'src/packages/redis/redis.service';
import {
    getUserCacheKey,
    CACHE_MODULES,
    getListCachePattern,
} from 'src/common/constants/cache-keys';
import { EXPIRED_TIME } from 'src/constants/redis';

@Injectable()
export class ExamAttemptService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly examAttemptRepository: ExamAttemptRepository,
        private readonly examSessionRepository: ExamSessionRepository,
        private readonly generateIdService: GenerateIdService,
        private readonly redisService: RedisService
    ) {}

    /**
     * Start a new exam attempt or resume existing one
     * Checks retry limits based on ExamSession settings
     */
    async startExamAttempt(user: User, dto: CreateExamAttemptDto) {
        // Verify exam session exists with all needed data
        const examSession = await this.prisma.examSession.findUnique({
            where: { id: dto.examSessionId },
            include: {
                examRoom: {
                    include: {
                        quizSet: {
                            include: {
                                detailsQuizQuestions: {
                                    include: {
                                        quizQuestion: true,
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });

        if (!examSession) {
            throw new NotFoundException('Phiên thi không tồn tại');
        }

        // Check if exam has started
        if (new Date(examSession.startTime) > new Date()) {
            throw new BadRequestException('Phiên thi chưa bắt đầu');
        }

        if (examSession.endTime && new Date(examSession.endTime) < new Date()) {
            throw new BadRequestException('Phiên thi đã kết thúc');
        }

        // Check time constraints
        const now = new Date();
        if (now < examSession.startTime) {
            throw new BadRequestException('Phiên thi chưa bắt đầu');
        }
        if (examSession.endTime && now > examSession.endTime) {
            throw new BadRequestException('Phiên thi đã kết thúc');
        }

        // Check for existing IN_PROGRESS attempt
        const existingInProgress = await this.prisma.examAttempt.findFirst({
            where: {
                examSessionId: dto.examSessionId,
                userId: user.id,
                status: EXAM_ATTEMPT_STATUS.IN_PROGRESS,
            },
        });

        if (existingInProgress) {
            // Resume existing attempt
            return {
                message: 'Tiếp tục làm bài',
                examAttempt: existingInProgress,
                isResume: true,
            };
        }

        // Count completed attempts
        const completedAttempts = await this.prisma.examAttempt.count({
            where: {
                examSessionId: dto.examSessionId,
                userId: user.id,
                status: EXAM_ATTEMPT_STATUS.COMPLETED,
            },
        });

        // Check retry limits (based on ExamSession, not ExamRoom)
        // maxAttempts means the number of RETRIES allowed (not including first attempt)
        // So total allowed attempts = 1 (first) + maxAttempts (retries)
        const totalAllowedAttempts = 1 + examSession.maxAttempts;

        if (!examSession.allowRetake && completedAttempts > 0) {
            throw new BadRequestException(
                'Bạn đã làm bài này rồi và không được phép làm lại'
            );
        }

        if (completedAttempts >= totalAllowedAttempts) {
            throw new BadRequestException(
                `Bạn đã đạt số lần thi tối đa (${totalAllowedAttempts} lần)`
            );
        }

        // Calculate total questions
        const totalQuestions =
            examSession.examRoom.quizSet.detailsQuizQuestions?.length || 0;

        try {
            const newExamAttempt = await this.prisma.examAttempt.create({
                data: {
                    id: this.generateIdService.generateId(),
                    examSessionId: dto.examSessionId,
                    userId: user.id,
                    score: 0,
                    violationCount: 0,
                    startedAt: new Date(),
                    status: EXAM_ATTEMPT_STATUS.IN_PROGRESS,
                    answers: {},
                    currentIndex: 0,
                    markedQuestions: [],
                    totalQuestions,
                    correctAnswers: 0,
                },
            });

            return {
                message: 'Bắt đầu làm bài thành công',
                examAttempt: newExamAttempt,
                isResume: false,
            };
        } catch (error) {
            throw new InternalServerErrorException('Bắt đầu làm bài thất bại');
        }
    }

    /**
     * Update exam attempt progress (auto-save)
     */
    async updateExamAttemptProgress(
        attemptId: string,
        user: User,
        dto: {
            answers?: Record<string, string>;
            currentIndex?: number;
            markedQuestions?: string[];
        }
    ) {
        // Verify ownership and status
        const attempt = await this.prisma.examAttempt.findFirst({
            where: { id: attemptId, userId: user.id },
        });

        if (!attempt) {
            throw new NotFoundException('Bài làm không tồn tại');
        }

        if (attempt.status !== EXAM_ATTEMPT_STATUS.IN_PROGRESS) {
            throw new BadRequestException('Bài làm đã nộp, không thể cập nhật');
        }

        try {
            const updateData: any = {};

            if (dto.answers !== undefined) {
                updateData.answers = dto.answers;
            }
            if (dto.currentIndex !== undefined) {
                updateData.currentIndex = dto.currentIndex;
            }
            if (dto.markedQuestions !== undefined) {
                updateData.markedQuestions = dto.markedQuestions;
            }

            const updatedAttempt = await this.prisma.examAttempt.update({
                where: { id: attemptId },
                data: updateData,
            });

            return {
                message: 'Cập nhật bài làm thành công',
                examAttempt: updatedAttempt,
            };
        } catch (error) {
            throw new InternalServerErrorException('Cập nhật bài làm thất bại');
        }
    }

    /**
     * Submit exam attempt - calculate score
     * Returns detailed answers based on showAnswersAfterSubmit setting
     */
    async submitExamAttempt(attemptId: string, user: User) {
        // Get attempt with session and questions
        const attempt = await this.prisma.examAttempt.findFirst({
            where: { id: attemptId, userId: user.id },
            include: {
                examSession: {
                    include: {
                        examRoom: {
                            include: {
                                quizSet: {
                                    include: {
                                        detailsQuizQuestions: {
                                            include: {
                                                quizQuestion: true,
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });

        if (!attempt) {
            throw new NotFoundException('Bài làm không tồn tại');
        }

        if (attempt.status !== EXAM_ATTEMPT_STATUS.IN_PROGRESS) {
            throw new BadRequestException('Bài làm đã được nộp trước đó');
        }

        // Calculate score
        const questions =
            attempt.examSession.examRoom.quizSet.detailsQuizQuestions
                ?.map((d) => d.quizQuestion)
                .filter((q) => q != null) || [];

        const answers = attempt.answers as Record<string, string>;
        let correctCount = 0;

        questions.forEach((q) => {
            if (q && q.id && answers[q.id] === q.answer) {
                correctCount++;
            }
        });

        const totalQuestions = questions.length;
        const score =
            totalQuestions > 0 ? (correctCount / totalQuestions) * 100 : 0;

        try {
            const updatedAttempt = await this.prisma.examAttempt.update({
                where: { id: attemptId },
                data: {
                    status: EXAM_ATTEMPT_STATUS.COMPLETED,
                    finishedAt: new Date(),
                    score,
                    correctAnswers: correctCount,
                    totalQuestions,
                },
            });

            const showAnswers = attempt.examSession.showAnswersAfterSubmit;
            console.log(
                '🚀 ~ ExamAttemptService ~ submitExamAttempt ~ attempt.examSession.showAnswersAfterSubmit:',
                attempt.examSession.showAnswersAfterSubmit
            );
            const passingScore = attempt.examSession.passingScore || 0;
            const passed = score >= passingScore;

            // Prepare response based on showAnswersAfterSubmit
            if (showAnswers) {
                // Return questions with correct answers
                return {
                    message: 'Nộp bài thành công',
                    examAttempt: updatedAttempt,
                    score,
                    totalQuestions,
                    correctAnswers: correctCount,
                    percentage: Math.round(score * 10) / 10,
                    showAnswers: true,
                    passed,
                    passingScore,
                    questions: questions.map((q) => ({
                        id: q.id,
                        question: q.question,
                        options: q.options,
                        answer: q.answer, // Include correct answer
                    })),
                };
            } else {
                // Only return score summary
                return {
                    message: 'Nộp bài thành công',
                    examAttempt: updatedAttempt,
                    score,
                    totalQuestions,
                    correctAnswers: correctCount,
                    percentage: Math.round(score * 10) / 10,
                    showAnswers: false,
                    passed,
                    passingScore,
                };
            }
        } catch (error) {
            throw new InternalServerErrorException('Nộp bài thất bại');
        }
    }

    /**
     * Get exam attempt with questions for quiz
     * Answers are stripped for students (only included for owners or after submit if allowed)
     */
    async getExamAttemptForQuiz(attemptId: string, user: User) {
        const attempt = await this.prisma.examAttempt.findFirst({
            where: { id: attemptId, userId: user.id },
            include: {
                examSession: {
                    include: {
                        examRoom: {
                            include: {
                                quizSet: {
                                    include: {
                                        detailsQuizQuestions: {
                                            include: {
                                                quizQuestion: true,
                                            },
                                        },
                                    },
                                },
                                host: {
                                    select: {
                                        id: true,
                                        username: true,
                                        name: true,
                                        avatar: true,
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });

        if (!attempt) {
            throw new NotFoundException('Bài làm không tồn tại');
        }

        const isOwner = attempt.examSession.examRoom.host.id === user.id;
        const showAnswers =
            attempt.status === EXAM_ATTEMPT_STATUS.COMPLETED &&
            attempt.examSession.showAnswersAfterSubmit;

        const questions =
            attempt.examSession.examRoom.quizSet.detailsQuizQuestions.map(
                (d) => {
                    const q = d.quizQuestion;
                    if (isOwner || showAnswers) {
                        return {
                            id: q.id,
                            question: q.question,
                            options: q.options,
                            answer: q.answer,
                        };
                    }
                    return {
                        id: q.id,
                        question: q.question,
                        options: q.options,
                    };
                }
            );

        // Calculate time limit from session
        let timeLimitMinutes: number | null = null;
        if (attempt.examSession.endTime) {
            const diffMs =
                attempt.examSession.endTime.getTime() -
                attempt.examSession.startTime.getTime();
            timeLimitMinutes = Math.floor(diffMs / 60000);
        }

        return {
            ...attempt,
            questions,
            timeLimitMinutes,
            creator: attempt.examSession.examRoom.host,
            isOwner,
        };
    }

    /**
     * Get all exam attempts for an exam room with user and session details
     * For displaying in the participants/attempts tab
     * Optimized with single query and proper joins
     */
    async getExamAttemptsByRoom(
        examRoomId: string,
        user: User,
        page: number = 1,
        limit: number = 10
    ) {
        // First verify user owns this exam room
        const examRoom = await this.prisma.examRoom.findUnique({
            where: { id: examRoomId },
            select: { hostId: true },
        });

        if (!examRoom) {
            throw new NotFoundException('Phòng thi không tồn tại');
        }

        if (examRoom.hostId !== user.id) {
            throw new ForbiddenException('Bạn không có quyền xem dữ liệu này');
        }

        const skip = (page - 1) * limit;

        // Get attempts with user and session info in single query
        const [attempts, total] = await Promise.all([
            this.prisma.examAttempt.findMany({
                where: {
                    examSession: {
                        examRoomId: examRoomId,
                    },
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true,
                            name: true,
                            email: true,
                            avatar: true,
                        },
                    },
                    examSession: {
                        select: {
                            id: true,
                            startTime: true,
                            endTime: true,
                        },
                    },
                },
                orderBy: { startedAt: 'desc' },
                skip,
                take: limit,
            }),
            this.prisma.examAttempt.count({
                where: {
                    examSession: {
                        examRoomId: examRoomId,
                    },
                },
            }),
        ]);

        // Transform data for frontend - O(n) single pass
        const transformedAttempts = attempts.map((attempt) => {
            // Calculate time spent (in seconds)
            let timeSpentSeconds = 0;
            if (attempt.finishedAt && attempt.startedAt) {
                timeSpentSeconds = Math.floor(
                    (new Date(attempt.finishedAt).getTime() -
                        new Date(attempt.startedAt).getTime()) /
                        1000
                );
            } else if (attempt.startedAt) {
                // Still in progress - calc from now
                timeSpentSeconds = Math.floor(
                    (Date.now() - new Date(attempt.startedAt).getTime()) / 1000
                );
            }

            return {
                id: attempt.id,
                status: attempt.status,
                score: attempt.score,
                totalQuestions: attempt.totalQuestions,
                correctAnswers: attempt.correctAnswers,
                startedAt: attempt.startedAt,
                finishedAt: attempt.finishedAt,
                timeSpentSeconds,
                answers: attempt.answers,
                user: attempt.user,
                session: {
                    id: attempt.examSession.id,
                    startTime: attempt.examSession.startTime,
                    endTime: attempt.examSession.endTime,
                },
            };
        });

        return {
            attempts: transformedAttempts,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        };
    }

    /**
     * Get single exam attempt details by ID
     * For displaying in detail slider
     */
    async getExamAttemptDetailForSlider(attemptId: string, user: User) {
        const attempt = await this.prisma.examAttempt.findUnique({
            where: { id: attemptId },
            include: {
                user: {
                    select: {
                        id: true,
                        username: true,
                        name: true,
                        email: true,
                        avatar: true,
                    },
                },
                examSession: {
                    include: {
                        examRoom: {
                            select: {
                                id: true,
                                hostId: true,
                                title: true,
                            },
                        },
                    },
                },
            },
        });

        if (!attempt) {
            throw new NotFoundException('Bài làm không tồn tại');
        }

        // Only owner can see attempt details
        if (attempt.examSession.examRoom.hostId !== user.id) {
            throw new ForbiddenException('Bạn không có quyền xem dữ liệu này');
        }

        // Calculate time spent
        let timeSpentSeconds = 0;
        if (attempt.finishedAt && attempt.startedAt) {
            timeSpentSeconds = Math.floor(
                (new Date(attempt.finishedAt).getTime() -
                    new Date(attempt.startedAt).getTime()) /
                    1000
            );
        }

        return {
            id: attempt.id,
            status: attempt.status,
            score: attempt.score,
            totalQuestions: attempt.totalQuestions,
            correctAnswers: attempt.correctAnswers,
            startedAt: attempt.startedAt,
            finishedAt: attempt.finishedAt,
            timeSpentSeconds,
            answers: attempt.answers,
            currentIndex: attempt.currentIndex,
            markedQuestions: attempt.markedQuestions,
            violationCount: attempt.violationCount,
            user: attempt.user,
            session: {
                id: attempt.examSession.id,
                startTime: attempt.examSession.startTime,
                endTime: attempt.examSession.endTime,
            },
            examRoom: {
                id: attempt.examSession.examRoom.id,
                title: attempt.examSession.examRoom.title,
            },
        };
    }

    /**
     * Get all exam attempts for a specific session (owner only)
     * Includes violationCount for cheating detection display
     */
    async getExamAttemptsBySession(
        sessionId: string,
        user: User,
        page: number = 1,
        limit: number = 50
    ) {
        // First verify user owns this session's exam room
        const session = await this.prisma.examSession.findUnique({
            where: { id: sessionId },
            include: {
                examRoom: {
                    select: { hostId: true },
                },
            },
        });

        if (!session) {
            throw new NotFoundException('Phiên thi không tồn tại');
        }

        if (session.examRoom.hostId !== user.id) {
            throw new ForbiddenException('Bạn không có quyền xem dữ liệu này');
        }

        const skip = (page - 1) * limit;

        // Get attempts with user info and violation count
        const [attempts, total] = await Promise.all([
            this.prisma.examAttempt.findMany({
                where: { examSessionId: sessionId },
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true,
                            name: true,
                            email: true,
                            avatar: true,
                        },
                    },
                    examSession: {
                        select: {
                            id: true,
                            startTime: true,
                            endTime: true,
                        },
                    },
                },
                orderBy: { score: 'desc' },
                skip,
                take: limit,
            }),
            this.prisma.examAttempt.count({
                where: { examSessionId: sessionId },
            }),
        ]);

        // Transform - O(n)
        const transformedAttempts = attempts.map((attempt) => {
            let timeSpentSeconds = 0;
            if (attempt.finishedAt && attempt.startedAt) {
                timeSpentSeconds = Math.floor(
                    (new Date(attempt.finishedAt).getTime() -
                        new Date(attempt.startedAt).getTime()) /
                        1000
                );
            }

            return {
                id: attempt.id,
                status: attempt.status,
                score: attempt.score,
                totalQuestions: attempt.totalQuestions,
                correctAnswers: attempt.correctAnswers,
                startedAt: attempt.startedAt,
                finishedAt: attempt.finishedAt,
                timeSpentSeconds,
                violationCount: attempt.violationCount,
                answers: attempt.answers,
                user: attempt.user,
                session: {
                    id: attempt.examSession.id,
                    startTime: attempt.examSession.startTime,
                    endTime: attempt.examSession.endTime,
                },
            };
        });

        return {
            attempts: transformedAttempts,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        };
    }

    // ==================== EXISTING METHODS ====================

    async createExamAttempt(user: User, dto: CreateExamAttemptDto) {
        // Verify exam session exists
        const examSession = await this.examSessionRepository.findOne({
            where: { id: dto.examSessionId },
            include: {
                examRoom: true,
            },
            cache: true,
        });

        if (!examSession) {
            throw new NotFoundException('Phiên thi không tồn tại');
        }

        // Check if exam has started
        if ((examSession as any).status === EXAM_SESSION_STATUS.UPCOMING) {
            throw new BadRequestException('Phiên thi chưa bắt đầu');
        }

        if ((examSession as any).status === EXAM_SESSION_STATUS.ENDED) {
            throw new BadRequestException('Phiên thi đã kết thúc');
        }

        // Check if user has reached max attempts
        const existingAttempts = await this.examAttemptRepository.findAll({
            where: {
                examSessionId: dto.examSessionId,
                userId: user.id,
            },
            cache: true,
        });

        const attemptCount = existingAttempts.length;

        // Use ExamSession settings for retry check
        if (!(examSession as any).allowRetake && attemptCount > 0) {
            throw new BadRequestException('Bạn đã hết lượt thi');
        }

        if (attemptCount >= (examSession as any).maxAttempts) {
            throw new BadRequestException(
                `Bạn đã đạt số lần thi tối đa (${(examSession as any).maxAttempts})`
            );
        }

        try {
            const newExamAttempt = await this.examAttemptRepository.create(
                {
                    id: this.generateIdService.generateId(),
                    examSessionId: dto.examSessionId,
                    userId: user.id,
                    score: 0,
                    violationCount: 0,
                    startedAt: new Date(),
                    status: EXAM_ATTEMPT_STATUS.IN_PROGRESS,
                },
                user.id
            );

            // Load relations for response
            const examAttemptWithRelations =
                await this.examAttemptRepository.findOne({
                    where: { id: newExamAttempt.id },
                    include: {
                        examSession: {
                            include: {
                                examRoom: {
                                    include: {
                                        quizSet: true,
                                    },
                                },
                            },
                        },
                        user: {
                            select: {
                                id: true,
                                email: true,
                                name: true,
                            },
                        },
                    },
                    cache: false,
                });

            return {
                message: 'Bắt đầu làm bài thành công',
                examAttempt: examAttemptWithRelations,
            };
        } catch (error) {
            throw new InternalServerErrorException('Bắt đầu làm bài thất bại');
        }
    }

    async getExamAttemptById(id: string, user: User) {
        const examAttempt = await this.examAttemptRepository.findOne({
            where: { id },
            include: {
                examSession: {
                    include: {
                        examRoom: {
                            include: {
                                quizSet: {
                                    include: {
                                        detailsQuizQuestions: {
                                            include: {
                                                quizQuestion: true,
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
                user: {
                    select: {
                        id: true,
                        email: true,
                        name: true,
                    },
                },
            },
            cache: true,
        });

        if (!examAttempt) {
            throw new NotFoundException('Bài làm không tồn tại');
        }

        // User can only view their own attempts, or host can view all attempts
        if (
            (examAttempt as any).userId !== user.id &&
            (examAttempt as any).examSession.examRoom.hostId !== user.id
        ) {
            throw new ForbiddenException('Bạn không có quyền xem bài làm này');
        }

        return examAttempt;
    }

    async deleteExamAttempt(id: string, user: User) {
        const examAttempt = await this.examAttemptRepository.findOne({
            where: { id },
            include: {
                examSession: {
                    include: {
                        examRoom: true,
                    },
                },
            },
            cache: false,
        });

        if (!examAttempt) {
            throw new NotFoundException('Bài làm không tồn tại');
        }

        // Only host can delete attempts
        if ((examAttempt as any).examSession.examRoom.hostId !== user.id) {
            throw new ForbiddenException('Bạn không có quyền xóa bài làm này');
        }

        // Hard delete - pass userId (host) for proper cache invalidation
        await this.examAttemptRepository.delete(id, user.id);
        return { message: 'Xóa bài làm thành công' };
    }

    async getExamAttempts(user: User, dto: GetExamAttemptsDto) {
        const where: any = {};

        // If examSessionId is provided, check if user is host or participant
        if (dto.examSessionId) {
            const examSession = await this.examSessionRepository.findOne({
                where: { id: dto.examSessionId },
                include: { examRoom: true },
                cache: true,
            });

            if (!examSession) {
                throw new NotFoundException('Phiên thi không tồn tại');
            }

            // Host can view all attempts, participants can only view their own
            if ((examSession as any).examRoom.hostId === user.id) {
                where.examSessionId = dto.examSessionId;
            } else {
                where.examSessionId = dto.examSessionId;
                where.userId = user.id;
            }
        } else {
            // If no examSessionId, only show user's own attempts
            where.userId = user.id;
        }

        if (dto.userId && dto.userId !== user.id) {
            // Only host can filter by other users - use Prisma directly for complex nested query
            const examSessions = await this.prisma.examSession.findMany({
                where: {
                    examRoom: {
                        hostId: user.id,
                    },
                },
                select: { id: true },
            });

            const sessionIds = examSessions.map((s) => s.id);
            where.examSessionId = { in: sessionIds };
            where.userId = dto.userId;
        }

        if (dto.status !== undefined) {
            where.status = dto.status;
        }

        const result = await this.examAttemptRepository.paginate(
            {
                page: dto.page || 1,
                size: dto.limit || 10,
                ...where,
                include: {
                    examSession: {
                        select: {
                            id: true,
                            startTime: true,
                            endTime: true,
                            examRoom: {
                                select: {
                                    id: true,
                                    title: true,
                                    quizSet: {
                                        select: {
                                            id: true,
                                            title: true,
                                            thumbnail: true,
                                        },
                                    },
                                },
                            },
                        },
                    },
                    user: {
                        select: {
                            id: true,
                            email: true,
                            name: true,
                        },
                    },
                },
                sortBy: 'startedAt',
                sortType: 'desc',
                cache: true,
            },
            user.id
        );

        return {
            examAttempts: result.data,
            total: result.total,
            page: result.page,
            limit: result.size,
            totalPages: result.totalPages,
        };
    }

    async updateExamAttempt(id: string, user: User, dto: UpdateExamAttemptDto) {
        const examAttempt = await this.examAttemptRepository.findOne({
            where: { id },
            include: {
                examSession: {
                    include: {
                        examRoom: true,
                    },
                },
            },
            cache: false,
        });

        if (!examAttempt) {
            throw new NotFoundException('Bài làm không tồn tại');
        }

        // User can update their own attempt, host can update any attempt
        if (
            (examAttempt as any).userId !== user.id &&
            (examAttempt as any).examSession.examRoom.hostId !== user.id
        ) {
            throw new ForbiddenException(
                'Bạn không có quyền chỉnh sửa bài làm này'
            );
        }

        const updateData: any = {};

        if (dto.score !== undefined) {
            updateData.score = dto.score;
        }

        if (dto.violationCount !== undefined) {
            updateData.violationCount = dto.violationCount;
        }

        if (dto.status !== undefined) {
            updateData.status = dto.status;
            // If status is COMPLETED or CANCELLED, set finishedAt
            if (
                dto.status === EXAM_ATTEMPT_STATUS.COMPLETED ||
                dto.status === EXAM_ATTEMPT_STATUS.CANCELLED
            ) {
                updateData.finishedAt = new Date();
            }
        }

        try {
            await this.examAttemptRepository.update(id, updateData, user.id);

            // Load with relations for response
            const updatedExamAttempt = await this.examAttemptRepository.findOne(
                {
                    where: { id },
                    include: {
                        examSession: {
                            include: {
                                examRoom: {
                                    include: {
                                        quizSet: true,
                                    },
                                },
                            },
                        },
                        user: {
                            select: {
                                id: true,
                                email: true,
                                name: true,
                            },
                        },
                    },
                    cache: false,
                }
            );

            return {
                message: 'Cập nhật bài làm thành công',
                examAttempt: updatedExamAttempt,
            };
        } catch (error) {
            if (error.code === 'P2025') {
                throw new NotFoundException('Bài làm không tồn tại');
            }
            throw new InternalServerErrorException('Cập nhật bài làm thất bại');
        }
    }

    /**
     * Get aggregated history statistics for user
     * Optimized with COUNT queries (O(1) with indexed fields) and Redis caching
     */
    async getHistoryStats(user: User) {
        const cacheKey = getUserCacheKey('QUIZ_STATS', user.id) + ':history';

        // Check cache first
        const cached = await this.redisService.get<{
            totalPDFs: number;
            examsCreated: number;
            flashcardSets: number;
            totalStudyHours: number;
        }>(cacheKey);

        if (cached) {
            return cached;
        }

        // Execute all count queries in parallel for O(1) performance
        const [totalPDFs, examsCreated, flashcardSets, examAttempts] =
            await Promise.all([
                // Count PDFs uploaded by user (indexed on userId)
                this.prisma.userStorage.count({
                    where: { userId: user.id },
                }),
                // Count quiz sets created by user (indexed on userId)
                this.prisma.quizSet.count({
                    where: { userId: user.id },
                }),
                // Count flashcard sets created by user (indexed on userId)
                this.prisma.flashCardSet.count({
                    where: { userId: user.id },
                }),
                // Get total time spent on exams (for study hours calculation)
                this.prisma.examAttempt.findMany({
                    where: {
                        userId: user.id,
                        status: EXAM_ATTEMPT_STATUS.COMPLETED,
                        finishedAt: { not: null },
                    },
                    select: {
                        startedAt: true,
                        finishedAt: true,
                    },
                }),
            ]);

        // Calculate total study hours from exam attempts
        let totalMinutes = 0;
        for (const attempt of examAttempts) {
            if (attempt.finishedAt && attempt.startedAt) {
                const diffMs =
                    new Date(attempt.finishedAt).getTime() -
                    new Date(attempt.startedAt).getTime();
                totalMinutes += diffMs / (1000 * 60);
            }
        }
        const totalStudyHours = Math.round(totalMinutes / 60);

        const stats = {
            totalPDFs,
            examsCreated,
            flashcardSets,
            totalStudyHours,
        };

        // Cache for 5 minutes
        await this.redisService.set(cacheKey, stats, EXPIRED_TIME.FIVE_MINUTES);

        return stats;
    }
}
