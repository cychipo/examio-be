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
import { EXAM_SESSION_STATUS, ASSESS_TYPE } from '../../types';
import { CreateExamSessionDto } from './dto/create-examsession.dto';
import { GetExamSessionsDto } from './dto/get-examsession.dto';
import { UpdateExamSessionDto } from './dto/update-examsession.dto';
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
            const newExamSession = await this.examSessionRepository.create({
                id: this.generateIdService.generateId(),
                examRoomId: dto.examRoomId,
                startTime,
                endTime,
                autoJoinByLink: dto.autoJoinByLink || false,
                status: EXAM_SESSION_STATUS.UPCOMING,
            });

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
                participants: {
                    include: {
                        user: {
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

        // Hard delete
        await this.examSessionRepository.delete(id);
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

        if (
            !examSession ||
            !(examSession as any).examRoom ||
            (examSession as any).examRoom.assessType !== ASSESS_TYPE.PUBLIC
        ) {
            throw new NotFoundException(
                'Phiên thi không tồn tại hoặc không công khai'
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

        const result = await this.examSessionRepository.paginate({
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
                        participants: true,
                        examAttempts: true,
                    },
                },
            },
            sortBy: 'startTime',
            sortType: 'desc',
            cache: true,
        });

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
}
