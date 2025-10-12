import { PrismaService } from 'src/prisma/prisma.service';
import {
    Injectable,
    NotFoundException,
    InternalServerErrorException,
    ForbiddenException,
    BadRequestException,
    ConflictException,
} from '@nestjs/common';
import { GenerateIdService } from 'src/common/services/generate-id.service';
import { User } from '@prisma/client';
import { ASSESS_TYPE, PARTICIPANT_STATUS } from '../../types';
import { CreateParticipantDto } from './dto/create-participant.dto';
import { GetParticipantsDto } from './dto/get-participant.dto';
import { UpdateParticipantDto } from './dto/update-participant.dto';

@Injectable()
export class ParticipantService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly generateIdService: GenerateIdService
    ) {}

    async joinExamSession(user: User, dto: CreateParticipantDto) {
        // Verify exam session exists
        const examSession = await this.prisma.examSession.findUnique({
            where: { id: dto.examSessionId },
            include: {
                examRoom: true,
            },
        });

        if (!examSession) {
            throw new NotFoundException('Phiên thi không tồn tại');
        }

        // Check if already joined
        const existingParticipant =
            await this.prisma.examSessionParticipant.findFirst({
                where: {
                    examSessionId: dto.examSessionId,
                    userId: user.id,
                },
            });

        if (existingParticipant) {
            throw new ConflictException('Bạn đã tham gia phiên thi này');
        }

        // For private rooms, need approval. For public rooms with autoJoinByLink, auto-approve
        const initialStatus =
            examSession.examRoom.assessType === ASSESS_TYPE.PUBLIC &&
            examSession.autoJoinByLink
                ? PARTICIPANT_STATUS.APPROVED
                : PARTICIPANT_STATUS.PENDING;

        try {
            const newParticipant =
                await this.prisma.examSessionParticipant.create({
                    data: {
                        id: this.generateIdService.generateId(),
                        examSessionId: dto.examSessionId,
                        userId: user.id,
                        status: initialStatus,
                        joinedAt:
                            initialStatus === PARTICIPANT_STATUS.APPROVED
                                ? new Date()
                                : null,
                    },
                    include: {
                        examSession: {
                            include: {
                                examRoom: {
                                    include: {
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
                });
            return {
                message:
                    initialStatus === PARTICIPANT_STATUS.APPROVED
                        ? 'Tham gia phiên thi thành công'
                        : 'Đã gửi yêu cầu tham gia',
                participant: newParticipant,
            };
        } catch (error) {
            throw new InternalServerErrorException(
                'Tham gia phiên thi thất bại'
            );
        }
    }

    async getParticipantById(id: string, user: User) {
        const participant = await this.prisma.examSessionParticipant.findUnique(
            {
                where: { id },
                include: {
                    examSession: {
                        include: {
                            examRoom: {
                                include: {
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
                    },
                    user: {
                        select: {
                            id: true,
                            email: true,
                            name: true,
                        },
                    },
                },
            }
        );

        if (!participant) {
            throw new NotFoundException('Người tham gia không tồn tại');
        }

        // User can view their own participation, or host can view all participants
        if (
            participant.userId !== user.id &&
            participant.examSession.examRoom.hostId !== user.id
        ) {
            throw new ForbiddenException(
                'Bạn không có quyền xem thông tin này'
            );
        }

        return participant;
    }

    async leaveExamSession(id: string, user: User) {
        const participant = await this.prisma.examSessionParticipant.findUnique(
            {
                where: { id },
                include: {
                    examSession: {
                        include: {
                            examRoom: true,
                        },
                    },
                },
            }
        );

        if (!participant) {
            throw new NotFoundException('Người tham gia không tồn tại');
        }

        if (participant.userId !== user.id) {
            throw new ForbiddenException(
                'Bạn không có quyền thực hiện hành động này'
            );
        }

        try {
            await this.prisma.examSessionParticipant.update({
                where: { id },
                data: {
                    status: PARTICIPANT_STATUS.LEFT,
                    leftAt: new Date(),
                },
            });
            return { message: 'Rời khỏi phiên thi thành công' };
        } catch (error) {
            throw new InternalServerErrorException(
                'Rời khỏi phiên thi thất bại'
            );
        }
    }

    async removeParticipant(id: string, user: User) {
        const participant = await this.prisma.examSessionParticipant.findUnique(
            {
                where: { id },
                include: {
                    examSession: {
                        include: {
                            examRoom: true,
                        },
                    },
                },
            }
        );

        if (!participant) {
            throw new NotFoundException('Người tham gia không tồn tại');
        }

        // Only host can remove participants
        if (participant.examSession.examRoom.hostId !== user.id) {
            throw new ForbiddenException(
                'Bạn không có quyền xóa người tham gia'
            );
        }

        try {
            await this.prisma.examSessionParticipant.delete({
                where: { id },
            });
            return { message: 'Xóa người tham gia thành công' };
        } catch (error) {
            throw new InternalServerErrorException(
                'Xóa người tham gia thất bại'
            );
        }
    }

    async getParticipants(user: User, dto: GetParticipantsDto) {
        const skip = ((dto.page || 1) - 1) * (dto.limit || 10);

        const where: any = {};

        if (dto.examSessionId) {
            // Verify user has access to this exam session
            const examSession = await this.prisma.examSession.findUnique({
                where: { id: dto.examSessionId },
                include: { examRoom: true },
            });

            if (!examSession) {
                throw new NotFoundException('Phiên thi không tồn tại');
            }

            // Only host or participants can view participant list
            const isHost = examSession.examRoom.hostId === user.id;
            const isParticipant =
                await this.prisma.examSessionParticipant.findFirst({
                    where: {
                        examSessionId: dto.examSessionId,
                        userId: user.id,
                    },
                });

            if (!isHost && !isParticipant) {
                throw new ForbiddenException(
                    'Bạn không có quyền xem danh sách người tham gia'
                );
            }

            where.examSessionId = dto.examSessionId;
        } else {
            // If no examSessionId, show user's own participations
            where.userId = user.id;
        }

        if (dto.status !== undefined) {
            where.status = dto.status;
        }

        const [participants, total] = await Promise.all([
            this.prisma.examSessionParticipant.findMany({
                where,
                skip,
                take: dto.limit || 10,
                orderBy: { createdAt: 'desc' },
                include: {
                    examSession: {
                        select: {
                            id: true,
                            startTime: true,
                            endTime: true,
                            status: true,
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
            }),
            this.prisma.examSessionParticipant.count({ where }),
        ]);

        return {
            participants,
            total,
            page: dto.page || 1,
            limit: dto.limit || 10,
            totalPages: Math.ceil(total / (dto.limit || 10)),
        };
    }

    async updateParticipant(id: string, user: User, dto: UpdateParticipantDto) {
        const participant = await this.prisma.examSessionParticipant.findUnique(
            {
                where: { id },
                include: {
                    examSession: {
                        include: {
                            examRoom: true,
                        },
                    },
                },
            }
        );

        if (!participant) {
            throw new NotFoundException('Người tham gia không tồn tại');
        }

        // Only host can approve/reject participants
        if (participant.examSession.examRoom.hostId !== user.id) {
            throw new ForbiddenException(
                'Bạn không có quyền chỉnh sửa trạng thái người tham gia'
            );
        }

        if (dto.status === undefined) {
            throw new BadRequestException('Cần cung cấp trạng thái mới');
        }

        const updateData: any = {
            status: dto.status,
        };

        // If approving, set joinedAt
        if (
            dto.status === PARTICIPANT_STATUS.APPROVED &&
            !participant.joinedAt
        ) {
            updateData.joinedAt = new Date();
        }

        // If leaving, set leftAt
        if (dto.status === PARTICIPANT_STATUS.LEFT && !participant.leftAt) {
            updateData.leftAt = new Date();
        }

        try {
            const updatedParticipant =
                await this.prisma.examSessionParticipant.update({
                    where: { id },
                    data: updateData,
                    include: {
                        examSession: {
                            include: {
                                examRoom: {
                                    include: {
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
                });

            return {
                message: 'Cập nhật trạng thái người tham gia thành công',
                participant: updatedParticipant,
            };
        } catch (error) {
            if (error.code === 'P2025') {
                throw new NotFoundException('Người tham gia không tồn tại');
            }
            throw new InternalServerErrorException(
                'Cập nhật trạng thái người tham gia thất bại'
            );
        }
    }
}
