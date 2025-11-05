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

@Injectable()
export class ExamAttemptService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly examAttemptRepository: ExamAttemptRepository,
        private readonly examSessionRepository: ExamSessionRepository,
        private readonly generateIdService: GenerateIdService
    ) {}

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

        if (!(examSession as any).examRoom.allowRetake && attemptCount > 0) {
            throw new BadRequestException('Bạn đã hết lượt thi');
        }

        if (attemptCount >= (examSession as any).examRoom.maxAttempts) {
            throw new BadRequestException(
                `Bạn đã đạt số lần thi tối đa (${(examSession as any).examRoom.maxAttempts})`
            );
        }

        try {
            const newExamAttempt = await this.examAttemptRepository.create({
                id: this.generateIdService.generateId(),
                examSessionId: dto.examSessionId,
                userId: user.id,
                score: 0,
                violationCount: 0,
                startedAt: new Date(),
                status: EXAM_ATTEMPT_STATUS.IN_PROGRESS,
            });

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

        // Hard delete
        await this.examAttemptRepository.delete(id);
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

        const result = await this.examAttemptRepository.paginate({
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
        });

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
}
