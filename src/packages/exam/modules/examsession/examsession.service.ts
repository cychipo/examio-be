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

@Injectable()
export class ExamSessionService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly generateIdService: GenerateIdService
    ) {}

    async createExamSession(user: User, dto: CreateExamSessionDto) {
        // Verify exam room exists and belongs to user
        const examRoom = await this.prisma.examRoom.findUnique({
            where: { id: dto.examRoomId },
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
            const newExamSession = await this.prisma.examSession.create({
                data: {
                    id: this.generateIdService.generateId(),
                    examRoomId: dto.examRoomId,
                    startTime,
                    endTime,
                    autoJoinByLink: dto.autoJoinByLink || false,
                    status: EXAM_SESSION_STATUS.UPCOMING,
                },
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
            });
            return {
                message: 'Tạo phiên thi thành công',
                examSession: newExamSession,
            };
        } catch (error) {
            throw new InternalServerErrorException('Tạo phiên thi thất bại');
        }
    }

    async getExamSessionById(id: string, user: User) {
        const examSession = await this.prisma.examSession.findUnique({
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
        });

        if (!examSession) {
            throw new NotFoundException('Phiên thi không tồn tại');
        }

        if (examSession.examRoom.hostId !== user.id) {
            throw new ForbiddenException(
                'Bạn không có quyền xem phiên thi này'
            );
        }

        return examSession;
    }

    async deleteExamSession(id: string, user: User) {
        const examSession = await this.prisma.examSession.findUnique({
            where: { id },
            include: { examRoom: true },
        });

        if (!examSession) {
            throw new NotFoundException('Phiên thi không tồn tại');
        }

        if (examSession.examRoom.hostId !== user.id) {
            throw new ForbiddenException(
                'Bạn không có quyền xóa phiên thi này'
            );
        }

        try {
            await this.prisma.examSession.delete({
                where: { id },
            });
            return { message: 'Xóa phiên thi thành công' };
        } catch (error) {
            throw new InternalServerErrorException('Xóa phiên thi thất bại');
        }
    }

    async getExamSessionPublicById(id: string) {
        const examSession = await this.prisma.examSession.findUnique({
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
        });

        if (
            !examSession ||
            !examSession.examRoom ||
            examSession.examRoom.assessType !== ASSESS_TYPE.PUBLIC
        ) {
            throw new NotFoundException(
                'Phiên thi không tồn tại hoặc không công khai'
            );
        }

        return examSession;
    }

    async getExamSessions(user: User, dto: GetExamSessionsDto) {
        const skip = ((dto.page || 1) - 1) * (dto.limit || 10);

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

        const [examSessions, total] = await Promise.all([
            this.prisma.examSession.findMany({
                where,
                skip,
                take: dto.limit || 10,
                orderBy: { startTime: 'desc' },
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
            }),
            this.prisma.examSession.count({ where }),
        ]);

        return {
            examSessions,
            total,
            page: dto.page || 1,
            limit: dto.limit || 10,
            totalPages: Math.ceil(total / (dto.limit || 10)),
        };
    }

    async updateExamSession(id: string, user: User, dto: UpdateExamSessionDto) {
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
            const updatedExamSession = await this.prisma.examSession.update({
                where: { id },
                data: updateData,
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
            });

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
