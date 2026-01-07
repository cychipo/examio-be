import { PrismaService } from '@examio/database';
import {
    Injectable,
    NotFoundException,
    InternalServerErrorException,
    ForbiddenException,
    BadRequestException,
} from '@nestjs/common';
import { GenerateIdService } from '@examio/common';
import { User } from '@prisma/client';
import { EXAM_SESSION_STATUS, ASSESS_TYPE, QUESTION_SELECTION_MODE, LabelQuestionConfig } from '../../types';
import { CreateExamSessionDto } from './dto/create-examsession.dto';
import { GetExamSessionsDto } from './dto/get-examsession.dto';
import { UpdateExamSessionDto } from './dto/update-examsession.dto';
import { ExamSessionUpdateSharingSettingsDto } from './dto/sharing.dto';
import { ExamSessionRepository } from './examsession.repository';
import { ExamRoomRepository } from '../examroom/examroom.repository';

@Injectable()
export class ExamSessionService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly examSessionRepository: ExamSessionRepository,
        private readonly examRoomRepository: ExamRoomRepository,
        private readonly generateIdService: GenerateIdService
    ) {}

    async createExamSession(user: User, dto: CreateExamSessionDto) {
        // Verify exam room exists and belongs to user
        const examRoom = await this.examRoomRepository.findOne({
            where: { id: dto.examRoomId },
            cache: true,
        });

        if (!examRoom) {
            throw new NotFoundException('Phòng thi không tồn tại');
        }

        if (examRoom.hostId !== user.id) {
            throw new ForbiddenException(
                'Bạn không có quyền tạo phiên thi cho phòng này'
            );
        }

        const startTime = new Date(dto.startTime);
        const endTime = dto.endTime ? new Date(dto.endTime) : null;

        if (endTime && endTime <= startTime) {
            throw new BadRequestException(
                'Thời gian kết thúc phải sau thời gian bắt đầu'
            );
        }

        try {
            // Validate question selection configuration
            await this.validateQuestionSelectionConfig(
                dto.examRoomId,
                dto.questionSelectionMode,
                dto.questionCount,
                dto.labelQuestionConfig
            );

            const newExamSession = await this.examSessionRepository.create(
                {
                    id: this.generateIdService.generateId(),
                    examRoomId: dto.examRoomId,
                    startTime,
                    endTime,
                    autoJoinByLink: dto.autoJoinByLink || false,
                    status: EXAM_SESSION_STATUS.UPCOMING,
                    // Security and access control fields
                    assessType: dto.assessType ?? ASSESS_TYPE.PUBLIC,
                    allowRetake: dto.allowRetake || false,
                    maxAttempts: dto.maxAttempts || 1,
                    accessCode: dto.accessCode || null,
                    whitelist: dto.whitelist || [],
                    showAnswersAfterSubmit: dto.showAnswersAfterSubmit ?? true,
                    // Question selection configuration
                    questionCount: dto.questionCount ?? null,
                    questionSelectionMode: dto.questionSelectionMode ?? QUESTION_SELECTION_MODE.ALL,
                    labelQuestionConfig: dto.labelQuestionConfig ?? null,
                    shuffleQuestions: dto.shuffleQuestions ?? false,
                },
                user.id
            );

            // Load relations for response
            const examSessionWithRelations =
                await this.examSessionRepository.findOne({
                    where: { id: newExamSession.id },
                    include: {
                        examRoom: {
                            include: {
                                quizSet: true,
                                host: {
                                    select: {
                                        id: true,
                                        email: true,
                                        name: true,
                                    },
                                },
                            },
                        },
                    },
                    cache: false,
                });

            return {
                message: 'Tạo phiên thi thành công',
                examSession: examSessionWithRelations,
            };
        } catch (error) {
            throw new InternalServerErrorException('Tạo phiên thi thất bại');
        }
    }

    async getExamSessionById(id: string, user: User) {
        const examSession = await this.examSessionRepository.findOne({
            where: { id },
            include: {
                examRoom: {
                    include: {
                        quizSet: true,
                        host: {
                            select: {
                                id: true,
                                email: true,
                                name: true,
                            },
                        },
                    },
                },
                _count: {
                    select: {
                        examAttempts: true,
                    },
                },
            },
            cache: true,
        });

        if (!examSession) {
            throw new NotFoundException('Phiên thi không tồn tại');
        }

        if ((examSession as any).examRoom.hostId !== user.id) {
            throw new ForbiddenException(
                'Bạn không có quyền xem phiên thi này'
            );
        }

        return examSession;
    }

    async deleteExamSession(id: string, user: User) {
        const examSession = await this.examSessionRepository.findOne({
            where: { id },
            include: { examRoom: true },
            cache: false,
        });

        if (!examSession) {
            throw new NotFoundException('Phiên thi không tồn tại');
        }

        if ((examSession as any).examRoom.hostId !== user.id) {
            throw new ForbiddenException(
                'Bạn không có quyền xóa phiên thi này'
            );
        }

        // Hard delete - pass userId for proper cache invalidation
        await this.examSessionRepository.delete(id, user.id);
        return { message: 'Xóa phiên thi thành công' };
    }

    async getExamSessionPublicById(id: string) {
        const examSession = await this.examSessionRepository.findOne({
            where: { id },
            include: {
                examRoom: {
                    include: {
                        quizSet: {
                            select: {
                                id: true,
                                title: true,
                                description: true,
                                thumbnail: true,
                            },
                        },
                        host: {
                            select: {
                                id: true,
                                email: true,
                                name: true,
                            },
                        },
                    },
                },
            },
            cache: true,
        });

        if (!examSession) {
            throw new NotFoundException('Phiên thi không tồn tại');
        }

        // Check if public access
        if ((examSession as any).assessType !== ASSESS_TYPE.PUBLIC) {
            throw new ForbiddenException(
                'Phiên thi này yêu cầu quyền truy cập'
            );
        }

        return examSession;
    }

    async getExamSessions(user: User, dto: GetExamSessionsDto) {
        const where: any = {
            examRoom: {
                hostId: user.id,
            },
        };

        if (dto.examRoomId) {
            where.examRoomId = dto.examRoomId;
        }

        if (dto.status !== undefined) {
            where.status = dto.status;
        }

        const result = await this.examSessionRepository.paginate(
            {
                page: dto.page || 1,
                size: dto.limit || 10,
                ...where,
                include: {
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
                    _count: {
                        select: {
                            examAttempts: true,
                        },
                    },
                },
                sortBy: 'startTime',
                sortType: 'desc',
                cache: true,
            },
            user.id
        );

        return {
            examSessions: result.data,
            total: result.total,
            page: result.page,
            limit: result.size,
            totalPages: result.totalPages,
        };
    }

    async updateExamSession(id: string, user: User, dto: UpdateExamSessionDto) {
        const examSession = await this.examSessionRepository.findOne({
            where: { id },
            include: { examRoom: true },
            cache: false,
        });

        if (!examSession) {
            throw new NotFoundException('Phiên thi không tồn tại');
        }

        if ((examSession as any).examRoom.hostId !== user.id) {
            throw new ForbiddenException(
                'Bạn không có quyền chỉnh sửa phiên thi này'
            );
        }

        const updateData: any = {};

        if (dto.startTime) {
            updateData.startTime = new Date(dto.startTime);
        }

        if (dto.endTime) {
            updateData.endTime = new Date(dto.endTime);
        }

        if (updateData.startTime && updateData.endTime) {
            if (updateData.endTime <= updateData.startTime) {
                throw new BadRequestException(
                    'Thời gian kết thúc phải sau thời gian bắt đầu'
                );
            }
        }

        if (dto.status !== undefined) {
            updateData.status = dto.status;
        }

        if (dto.autoJoinByLink !== undefined) {
            updateData.autoJoinByLink = dto.autoJoinByLink;
        }

        // Security and access control fields
        if (dto.assessType !== undefined) {
            updateData.assessType = dto.assessType;
        }

        if (dto.allowRetake !== undefined) {
            updateData.allowRetake = dto.allowRetake;
        }

        if (dto.maxAttempts !== undefined) {
            updateData.maxAttempts = dto.maxAttempts;
        }

        if (dto.accessCode !== undefined) {
            updateData.accessCode = dto.accessCode;
        }

        if (dto.whitelist !== undefined) {
            updateData.whitelist = dto.whitelist;
        }

        if (dto.showAnswersAfterSubmit !== undefined) {
            updateData.showAnswersAfterSubmit = dto.showAnswersAfterSubmit;
        }

        if (dto.passingScore !== undefined) {
            updateData.passingScore = dto.passingScore;
        }

        // Question selection configuration
        if (dto.questionCount !== undefined) {
            updateData.questionCount = dto.questionCount;
        }

        if (dto.questionSelectionMode !== undefined) {
            updateData.questionSelectionMode = dto.questionSelectionMode;
        }

        if (dto.labelQuestionConfig !== undefined) {
            updateData.labelQuestionConfig = dto.labelQuestionConfig;
        }

        if (dto.shuffleQuestions !== undefined) {
            updateData.shuffleQuestions = dto.shuffleQuestions;
        }

        // Validate question selection configuration if being updated
        if (
            dto.questionSelectionMode !== undefined ||
            dto.questionCount !== undefined ||
            dto.labelQuestionConfig !== undefined
        ) {
            await this.validateQuestionSelectionConfig(
                examSession.examRoomId,
                dto.questionSelectionMode ?? examSession.questionSelectionMode,
                dto.questionCount !== undefined ? dto.questionCount : examSession.questionCount,
                dto.labelQuestionConfig !== undefined ? dto.labelQuestionConfig : examSession.labelQuestionConfig as LabelQuestionConfig[] | null
            );
        }

        try {
            await this.examSessionRepository.update(id, updateData, user.id);

            // Load with relations for response
            const updatedExamSession = await this.examSessionRepository.findOne(
                {
                    where: { id },
                    include: {
                        examRoom: {
                            include: {
                                quizSet: true,
                                host: {
                                    select: {
                                        id: true,
                                        email: true,
                                        name: true,
                                    },
                                },
                            },
                        },
                    },
                    cache: false,
                }
            );

            return {
                message: 'Cập nhật phiên thi thành công',
                examSession: updatedExamSession,
            };
        } catch (error) {
            if (error.code === 'P2025') {
                throw new NotFoundException('Phiên thi không tồn tại');
            }
            throw new InternalServerErrorException(
                'Cập nhật phiên thi thất bại'
            );
        }
    }

    // ==================== ACCESS CONTROL METHODS ====================

    /**
     * Check access for an exam session (public endpoint)
     */
    async checkAccess(id: string, userId?: string) {
        const examSession = await this.prisma.examSession.findUnique({
            where: { id },
            select: {
                id: true,
                assessType: true,
                accessCode: true,
                whitelist: true,
                examRoom: {
                    select: {
                        hostId: true,
                    },
                },
            },
        });

        if (!examSession) {
            throw new NotFoundException('Phiên thi không tồn tại');
        }

        // Public access
        if (examSession.assessType === ASSESS_TYPE.PUBLIC) {
            return {
                hasAccess: true,
                accessType: 'public' as const,
            };
        }

        // Owner access
        if (userId && examSession.examRoom.hostId === userId) {
            return {
                hasAccess: true,
                accessType: 'owner' as const,
            };
        }

        // Whitelist access
        if (userId && examSession.whitelist.includes(userId)) {
            return {
                hasAccess: true,
                accessType: 'whitelist' as const,
            };
        }

        // Code required
        if (examSession.accessCode) {
            return {
                hasAccess: false,
                accessType: 'code_required' as const,
                requiresCode: true,
            };
        }

        return {
            hasAccess: false,
            accessType: 'denied' as const,
        };
    }

    /**
     * Verify access code for a private exam session
     */
    async verifyAccessCode(id: string, accessCode: string) {
        const examSession = await this.prisma.examSession.findUnique({
            where: { id },
            select: { accessCode: true },
        });

        if (!examSession) {
            throw new NotFoundException('Phiên thi không tồn tại');
        }

        if (examSession.accessCode?.toString() !== accessCode) {
            throw new ForbiddenException('Mã truy cập không đúng');
        }

        return {
            valid: true,
            message: 'Mã xác thực hợp lệ',
        };
    }

    /**
     * Get exam session for study (with access check)
     */
    async getExamSessionForStudy(id: string, userId?: string) {
        // First check access
        const accessInfo = await this.checkAccess(id, userId);

        if (
            !accessInfo.hasAccess &&
            accessInfo.accessType !== 'code_required'
        ) {
            throw new ForbiddenException(
                'Bạn không có quyền truy cập phiên thi này'
            );
        }

        if (accessInfo.accessType === 'code_required') {
            throw new ForbiddenException('Yêu cầu mã truy cập');
        }

        const examSession = await this.prisma.examSession.findUnique({
            where: { id },
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
        });

        if (!examSession) {
            throw new NotFoundException('Phiên thi không tồn tại');
        }

        const isOwner = userId && examSession.examRoom.hostId === userId;

        return {
            ...examSession,
            questions: examSession.examRoom.quizSet.detailsQuizQuestions.map(
                (d) => {
                    const q = d.quizQuestion;
                    // Only include answer if user is the owner
                    if (isOwner) {
                        return q;
                    }
                    // Strip answer for non-owners
                    return {
                        id: q.id,
                        question: q.question,
                        options: q.options,
                    };
                }
            ),
            creator: examSession.examRoom.host,
            isOwner,
        };
    }

    /**
     * Get exam session after code verification
     */
    async getExamSessionWithCode(id: string, accessCode: string) {
        // Verify code first
        await this.verifyAccessCode(id, accessCode);

        const examSession = await this.prisma.examSession.findUnique({
            where: { id },
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
        });

        if (!examSession) {
            throw new NotFoundException('Phiên thi không tồn tại');
        }

        return {
            ...examSession,
            questions: examSession.examRoom.quizSet.detailsQuizQuestions.map(
                (d) => {
                    const q = d.quizQuestion;
                    // Code access = not owner, strip answers
                    return {
                        id: q.id,
                        question: q.question,
                        options: q.options,
                    };
                }
            ),
            creator: examSession.examRoom.host,
            isOwner: false,
        };
    }

    /**
     * Get public info for an exam session (without questions)
     */
    async getExamSessionPublicInfo(id: string) {
        const examSession = await this.prisma.examSession.findUnique({
            where: { id },
            select: {
                id: true,
                status: true,
                startTime: true,
                endTime: true,
                assessType: true,
                accessCode: true,
                examRoom: {
                    select: {
                        id: true,
                        title: true,
                        description: true,
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
        });

        if (!examSession) {
            throw new NotFoundException('Phiên thi không tồn tại');
        }

        return {
            id: examSession.id,
            title: examSession.examRoom.title,
            description: examSession.examRoom.description,
            startTime: examSession.startTime.toISOString(),
            endTime: examSession.endTime?.toISOString(),
            status: examSession.status,
            isPublic: examSession.assessType === ASSESS_TYPE.PUBLIC,
            requiresCode:
                examSession.assessType !== ASSESS_TYPE.PUBLIC &&
                !!examSession.accessCode,
            creator: examSession.examRoom.host,
            examRoom: {
                id: examSession.examRoom.id,
                title: examSession.examRoom.title,
                description: examSession.examRoom.description,
            },
        };
    }

    /**
     * Update sharing settings for an exam session
     */
    async updateSharingSettings(
        id: string,
        user: User,
        dto: ExamSessionUpdateSharingSettingsDto
    ) {
        // Check ownership
        const examSession = await this.prisma.examSession.findUnique({
            where: { id },
            include: { examRoom: true },
        });

        if (!examSession) {
            throw new NotFoundException('Phiên thi không tồn tại');
        }

        if (examSession.examRoom.hostId !== user.id) {
            throw new ForbiddenException(
                'Bạn không có quyền chỉnh sửa phiên thi này'
            );
        }

        // Update sharing settings
        const updatedExamSession = await this.prisma.examSession.update({
            where: { id },
            data: {
                assessType: dto.isPublic
                    ? ASSESS_TYPE.PUBLIC
                    : ASSESS_TYPE.PRIVATE,
                accessCode: dto.isPublic ? null : dto.accessCode,
                whitelist: dto.isPublic ? [] : dto.whitelist || [],
            },
            select: {
                id: true,
                assessType: true,
                accessCode: true,
                whitelist: true,
            },
        });

        return {
            message: 'Cập nhật cài đặt chia sẻ thành công',
            isPublic: updatedExamSession.assessType === ASSESS_TYPE.PUBLIC,
            accessCode: updatedExamSession.accessCode,
            whitelist: updatedExamSession.whitelist,
        };
    }

    /**
     * Generate a random 6-digit access code
     */
    generateAccessCode(): string {
        return Math.floor(100000 + Math.random() * 900000).toString();
    }

    /**
     * Get sharing settings for owner
     */
    async getSharingSettings(id: string, user: User) {
        const examSession = await this.prisma.examSession.findFirst({
            where: { id },
            select: {
                id: true,
                assessType: true,
                accessCode: true,
                whitelist: true,
                examRoom: {
                    select: {
                        hostId: true,
                    },
                },
            },
        });

        if (!examSession) {
            throw new NotFoundException('Phiên thi không tồn tại');
        }

        if (examSession.examRoom.hostId !== user.id) {
            throw new ForbiddenException(
                'Bạn không có quyền xem cài đặt chia sẻ này'
            );
        }

        const users = await this.prisma.user.findMany({
            where: {
                id: {
                    in: examSession.whitelist,
                },
            },
            select: {
                id: true,
                username: true,
                name: true,
                avatar: true,
                email: true,
            },
        });

        return {
            id: examSession.id,
            isPublic: examSession.assessType === ASSESS_TYPE.PUBLIC,
            accessCode: examSession.accessCode,
            whitelist: users,
        };
    }

    /**
     * Search users by username for whitelist
     */
    async searchUsers(query: string, currentUserId: string) {
        if (!query || query.length < 2) {
            return [];
        }

        const users = await this.prisma.user.findMany({
            where: {
                AND: [
                    { id: { not: currentUserId } },
                    {
                        OR: [
                            {
                                username: {
                                    contains: query,
                                    mode: 'insensitive',
                                },
                            },
                            { name: { contains: query, mode: 'insensitive' } },
                            { email: { contains: query, mode: 'insensitive' } },
                        ],
                    },
                ],
            },
            select: {
                id: true,
                username: true,
                name: true,
                avatar: true,
                email: true,
            },
            take: 10,
        });

        return users;
    }

    /**
     * Get exam session stats for student display
     * Returns only required fields to avoid data leakage:
     * - durationMinutes: endTime - startTime (null if no endTime)
     * - totalQuestions: from quizSet
     * - passingScore: percentage (0 = no minimum)
     * - currentAttempt: current attempt number for user
     * - maxAttempts: null if unlimited
     * - progress: from latest in-progress attempt
     */
    async getExamSessionStatsForStudent(id: string, userId: string) {
        const examSession = await this.prisma.examSession.findUnique({
            where: { id },
            select: {
                id: true,
                status: true,
                startTime: true,
                endTime: true,
                passingScore: true,
                allowRetake: true,
                maxAttempts: true,
                questionCount: true,
                questionSelectionMode: true,
                shuffleQuestions: true,
                examRoom: {
                    select: {
                        id: true,
                        title: true,
                        description: true,
                        quizSet: {
                            select: {
                                _count: {
                                    select: { detailsQuizQuestions: true },
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

        // Calculate duration in minutes if endTime exists
        let durationMinutes: number | null = null;
        if (examSession.endTime) {
            const start = examSession.startTime.getTime();
            const end = examSession.endTime.getTime();
            durationMinutes = Math.floor((end - start) / (1000 * 60));
        }

        // Get total questions from quiz set
        const totalQuestions =
            examSession.examRoom.quizSet._count.detailsQuizQuestions;

        // Get user's attempts for this session
        const userAttempts = await this.prisma.examAttempt.findMany({
            where: {
                examSessionId: id,
                userId: userId,
            },
            select: {
                id: true,
                status: true,
                answers: true,
                markedQuestions: true,
                totalQuestions: true,
                createdAt: true,
            },
            orderBy: { createdAt: 'desc' },
        });

        // Current attempt count
        const currentAttempt = userAttempts.length;

        // Max attempts - null if unlimited (allowRetake = false means only 1 try)
        const maxAttempts = examSession.allowRetake
            ? examSession.maxAttempts
            : null;

        // Find latest in-progress attempt for progress display
        const inProgressAttempt = userAttempts.find((a) => a.status === 0); // 0 = IN_PROGRESS

        // Calculate progress
        let progress = {
            answered: 0,
            marked: 0,
            total: totalQuestions,
        };

        if (inProgressAttempt) {
            const answers = inProgressAttempt.answers as Record<string, string>;
            progress.answered = Object.keys(answers).length;
            progress.marked = inProgressAttempt.markedQuestions.length;
            progress.total = inProgressAttempt.totalQuestions || totalQuestions;
        }

        return {
            id: examSession.id,
            title: examSession.examRoom.title,
            description: examSession.examRoom.description,
            startTime: examSession.startTime.toISOString(),
            endTime: examSession.endTime?.toISOString() || null,
            status: examSession.status,
            // Stats fields
            durationMinutes,
            totalQuestions,
            passingScore: examSession.passingScore,
            // Attempt info
            currentAttempt,
            maxAttempts,
            // Progress
            progress,
            // Question selection config
            questionCount: examSession.questionCount,
            questionSelectionMode: examSession.questionSelectionMode,
            shuffleQuestions: examSession.shuffleQuestions,
        };
    }

    /**
     * Validate question selection configuration
     * Ensures the configuration is valid before creating/updating an exam session
     */
    private async validateQuestionSelectionConfig(
        examRoomId: string,
        questionSelectionMode?: QUESTION_SELECTION_MODE,
        questionCount?: number | null,
        labelQuestionConfig?: LabelQuestionConfig[] | null
    ): Promise<void> {
        // Get the quiz set and its questions count
        const examRoom = await this.prisma.examRoom.findUnique({
            where: { id: examRoomId },
            include: {
                quizSet: {
                    include: {
                        _count: {
                            select: { detailsQuizQuestions: true },
                        },
                        labels: {
                            include: {
                                _count: {
                                    select: { detailsQuizQuestions: true },
                                },
                            },
                        },
                    },
                },
            },
        });

        if (!examRoom || !examRoom.quizSet) {
            throw new NotFoundException('Phòng thi hoặc bộ đề không tồn tại');
        }

        const totalAvailableQuestions = examRoom.quizSet._count.detailsQuizQuestions;
        const mode = questionSelectionMode ?? QUESTION_SELECTION_MODE.ALL;

        // Validate RANDOM_TOTAL mode
        if (mode === QUESTION_SELECTION_MODE.RANDOM_TOTAL) {
            if (!questionCount || questionCount <= 0) {
                throw new BadRequestException(
                    'Phải chỉ định số câu hỏi khi sử dụng chế độ random từ tổng số câu'
                );
            }
            if (questionCount > totalAvailableQuestions) {
                throw new BadRequestException(
                    `Số câu hỏi (${questionCount}) không được vượt quá tổng số câu trong bộ đề (${totalAvailableQuestions})`
                );
            }
        }

        // Validate RANDOM_BY_LABEL mode
        if (mode === QUESTION_SELECTION_MODE.RANDOM_BY_LABEL) {
            if (!labelQuestionConfig || labelQuestionConfig.length === 0) {
                throw new BadRequestException(
                    'Phải cấu hình số câu cho từng nhãn khi sử dụng chế độ random theo nhãn'
                );
            }

            // Get unlabeled questions count
            const unlabeledCount = await this.prisma.detailsQuizQuestion.count({
                where: { quizSetId: examRoom.quizSetId, labelId: null },
            });

            // Create a map of label ID to available question count
            const labelQuestionCounts = new Map<string, number>();
            for (const label of examRoom.quizSet.labels) {
                labelQuestionCounts.set(label.id, label._count.detailsQuizQuestions);
            }
            labelQuestionCounts.set('unlabeled', unlabeledCount);

            let totalConfiguredCount = 0;
            const usedLabelIds = new Set<string>();

            for (const config of labelQuestionConfig) {
                // Check for duplicate label IDs
                if (usedLabelIds.has(config.labelId)) {
                    throw new BadRequestException(
                        `Nhãn "${config.labelId}" được cấu hình nhiều lần`
                    );
                }
                usedLabelIds.add(config.labelId);

                // Check if label exists (or is 'unlabeled')
                const availableInLabel = labelQuestionCounts.get(config.labelId);
                if (availableInLabel === undefined) {
                    throw new BadRequestException(
                        `Nhãn với ID "${config.labelId}" không tồn tại trong bộ đề`
                    );
                }

                // Check if requested count doesn't exceed available
                if (config.count > availableInLabel) {
                    const labelName = config.labelId === 'unlabeled' 
                        ? 'Chưa gán nhãn' 
                        : examRoom.quizSet.labels.find(l => l.id === config.labelId)?.name || config.labelId;
                    throw new BadRequestException(
                        `Số câu yêu cầu cho nhãn "${labelName}" (${config.count}) vượt quá số câu có sẵn (${availableInLabel})`
                    );
                }

                totalConfiguredCount += config.count;
            }

            // If questionCount is specified, validate total matches
            if (questionCount !== null && questionCount !== undefined) {
                if (totalConfiguredCount !== questionCount) {
                    throw new BadRequestException(
                        `Tổng số câu cấu hình theo nhãn (${totalConfiguredCount}) phải bằng tổng số câu của phiên thi (${questionCount})`
                    );
                }
            }

            // Ensure total configured doesn't exceed available
            if (totalConfiguredCount > totalAvailableQuestions) {
                throw new BadRequestException(
                    `Tổng số câu cấu hình (${totalConfiguredCount}) vượt quá số câu có sẵn (${totalAvailableQuestions})`
                );
            }
        }
    }

    /**
     * Get available labels and their question counts for a quiz set linked to an exam room
     * This is used by the frontend to display label options for configuration
     */
    async getAvailableLabelsForExamRoom(examRoomId: string, user: User) {
        const examRoom = await this.prisma.examRoom.findUnique({
            where: { id: examRoomId },
            include: {
                quizSet: {
                    include: {
                        labels: {
                            include: {
                                _count: {
                                    select: { detailsQuizQuestions: true },
                                },
                            },
                            orderBy: { order: 'asc' },
                        },
                        _count: {
                            select: { detailsQuizQuestions: true },
                        },
                    },
                },
            },
        });

        if (!examRoom) {
            throw new NotFoundException('Phòng thi không tồn tại');
        }

        if (examRoom.hostId !== user.id) {
            throw new ForbiddenException('Bạn không có quyền truy cập phòng này');
        }

        // Get unlabeled questions count
        const unlabeledCount = await this.prisma.detailsQuizQuestion.count({
            where: { quizSetId: examRoom.quizSetId, labelId: null },
        });

        return {
            totalQuestions: examRoom.quizSet._count.detailsQuizQuestions,
            labels: examRoom.quizSet.labels.map((label) => ({
                id: label.id,
                name: label.name,
                color: label.color,
                questionCount: label._count.detailsQuizQuestions,
            })),
            unlabeledCount,
        };
    }
}
