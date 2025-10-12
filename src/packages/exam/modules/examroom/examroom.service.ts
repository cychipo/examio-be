import { PrismaService } from 'src/prisma/prisma.service';
import {
    Injectable,
    ConflictException,
    NotFoundException,
    InternalServerErrorException,
    ForbiddenException,
} from '@nestjs/common';
import { GenerateIdService } from 'src/common/services/generate-id.service';
import { User } from '@prisma/client';
import { ASSESS_TYPE } from '../../types';
import { CreateExamRoomDto } from './dto/create-examroom.dto';
import { GetExamRoomsDto } from './dto/get-examroom.dto';
import { UpdateExamRoomDto } from './dto/update-examroom.dto';

@Injectable()
export class ExamRoomService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly generateIdService: GenerateIdService
    ) {}

    async createExamRoom(user: User, dto: CreateExamRoomDto) {
        if (!dto.title || dto.title.trim() === '') {
            throw new ConflictException('Tiêu đề không được để trống');
        }

        // Verify quiz set exists and belongs to user
        const quizSet = await this.prisma.quizSet.findUnique({
            where: { id: dto.quizSetId, userId: user.id },
        });

        if (!quizSet) {
            throw new NotFoundException(
                'Bộ câu hỏi không tồn tại hoặc không thuộc về bạn'
            );
        }

        try {
            const newExamRoom = await this.prisma.examRoom.create({
                data: {
                    id: this.generateIdService.generateId(),
                    title: dto.title,
                    description: dto.description || '',
                    quizSetId: dto.quizSetId,
                    hostId: user.id,
                    assessType: dto.assessType ?? ASSESS_TYPE.PUBLIC,
                    allowRetake: dto.allowRetake || false,
                    maxAttempts: dto.maxAttempts || 1,
                },
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
            });
            return {
                message: 'Tạo phòng thi thành công',
                examRoom: newExamRoom,
            };
        } catch (error) {
            throw new InternalServerErrorException('Tạo phòng thi thất bại');
        }
    }

    async getExamRoomById(id: string, user: User) {
        const examRoom = await this.prisma.examRoom.findUnique({
            where: { id, hostId: user.id },
            include: {
                quizSet: true,
                host: {
                    select: {
                        id: true,
                        email: true,
                        name: true,
                    },
                },
                examSessions: {
                    orderBy: { startTime: 'desc' },
                },
            },
        });
        if (!examRoom) {
            throw new NotFoundException('Phòng thi không tồn tại');
        }
        return examRoom;
    }

    async deleteExamRoom(id: string, user: User) {
        const result = await this.prisma.examRoom.deleteMany({
            where: {
                id,
                hostId: user.id,
            },
        });

        if (result.count === 0) {
            throw new NotFoundException('Phòng thi không tồn tại');
        }

        return { message: 'Xóa phòng thi thành công' };
    }

    async getExamRoomPublicById(id: string) {
        const examRoom = await this.prisma.examRoom.findUnique({
            where: { id, assessType: ASSESS_TYPE.PUBLIC },
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
        });
        if (!examRoom) {
            throw new NotFoundException(
                'Phòng thi không tồn tại hoặc không công khai'
            );
        }
        return examRoom;
    }

    async getExamRooms(user: User, dto: GetExamRoomsDto) {
        const skip = ((dto.page || 1) - 1) * (dto.limit || 10);

        const where: any = {
            hostId: user.id,
        };

        if (dto.search) {
            where.OR = [
                { title: { contains: dto.search, mode: 'insensitive' } },
                { description: { contains: dto.search, mode: 'insensitive' } },
            ];
        }

        if (dto.assessType !== undefined) {
            where.assessType = dto.assessType;
        }

        if (dto.quizSetId) {
            where.quizSetId = dto.quizSetId;
        }

        const [examRooms, total] = await Promise.all([
            this.prisma.examRoom.findMany({
                where,
                skip,
                take: dto.limit || 10,
                orderBy: { createdAt: 'desc' },
                include: {
                    quizSet: {
                        select: {
                            id: true,
                            title: true,
                            thumbnail: true,
                        },
                    },
                    _count: {
                        select: {
                            examSessions: true,
                        },
                    },
                },
            }),
            this.prisma.examRoom.count({ where }),
        ]);

        return {
            examRooms,
            total,
            page: dto.page || 1,
            limit: dto.limit || 10,
            totalPages: Math.ceil(total / (dto.limit || 10)),
        };
    }

    async updateExamRoom(id: string, user: User, dto: UpdateExamRoomDto) {
        // Check if exam room exists and belongs to user
        const existingRoom = await this.prisma.examRoom.findUnique({
            where: { id },
        });

        if (!existingRoom) {
            throw new NotFoundException('Phòng thi không tồn tại');
        }

        if (existingRoom.hostId !== user.id) {
            throw new ForbiddenException(
                'Bạn không có quyền chỉnh sửa phòng thi này'
            );
        }

        // If updating quizSetId, verify it exists and belongs to user
        if (dto.quizSetId) {
            const quizSet = await this.prisma.quizSet.findUnique({
                where: { id: dto.quizSetId, userId: user.id },
            });

            if (!quizSet) {
                throw new NotFoundException(
                    'Bộ câu hỏi không tồn tại hoặc không thuộc về bạn'
                );
            }
        }

        try {
            const updatedExamRoom = await this.prisma.examRoom.update({
                where: {
                    id,
                },
                data: {
                    ...(dto.title && { title: dto.title }),
                    ...(dto.description !== undefined && {
                        description: dto.description,
                    }),
                    ...(dto.quizSetId && { quizSetId: dto.quizSetId }),
                    ...(dto.assessType !== undefined && {
                        assessType: dto.assessType,
                    }),
                    ...(dto.allowRetake !== undefined && {
                        allowRetake: dto.allowRetake,
                    }),
                    ...(dto.maxAttempts && { maxAttempts: dto.maxAttempts }),
                },
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
            });

            return {
                message: 'Cập nhật phòng thi thành công',
                examRoom: updatedExamRoom,
            };
        } catch (error) {
            if (error.code === 'P2025') {
                throw new NotFoundException('Phòng thi không tồn tại');
            }
            throw new InternalServerErrorException(
                'Cập nhật phòng thi thất bại'
            );
        }
    }
}
