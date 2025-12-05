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
import { ExamRoomRepository } from './examroom.repository';
import { QuizSetRepository } from '../quizset/quizset.repository';

@Injectable()
export class ExamRoomService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly examRoomRepository: ExamRoomRepository,
        private readonly quizSetRepository: QuizSetRepository,
        private readonly generateIdService: GenerateIdService
    ) {}

    async createExamRoom(user: User, dto: CreateExamRoomDto) {
        if (!dto.title || dto.title.trim() === '') {
            throw new ConflictException('Tiêu đề không được để trống');
        }

        // Verify quiz set exists and belongs to user
        const quizSet = await this.quizSetRepository.findOne({
            where: { id: dto.quizSetId, userId: user.id },
            cache: true,
        });

        if (!quizSet) {
            throw new NotFoundException(
                'Bộ câu hỏi không tồn tại hoặc không thuộc về bạn'
            );
        }

        try {
            const newExamRoom = await this.examRoomRepository.create(
                {
                    id: this.generateIdService.generateId(),
                    title: dto.title,
                    description: dto.description || '',
                    quizSetId: dto.quizSetId,
                    hostId: user.id,
                    assessType: dto.assessType ?? ASSESS_TYPE.PUBLIC,
                    allowRetake: dto.allowRetake || false,
                    maxAttempts: dto.maxAttempts || 1,
                },
                user.id
            );

            // Load relations for response
            const examRoomWithRelations = await this.examRoomRepository.findOne(
                {
                    where: { id: newExamRoom.id },
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
                    cache: false,
                }
            );

            return {
                message: 'Tạo phòng thi thành công',
                examRoom: examRoomWithRelations,
            };
        } catch (error) {
            throw new InternalServerErrorException('Tạo phòng thi thất bại');
        }
    }

    async getExamRoomById(id: string, user: User) {
        const examRoom = await this.examRoomRepository.findOne({
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
            cache: true,
        });
        if (!examRoom) {
            throw new NotFoundException('Phòng thi không tồn tại');
        }
        return examRoom;
    }

    async deleteExamRoom(id: string, user: User) {
        // Check ownership
        const examRoom = await this.examRoomRepository.findOne({
            where: { id, hostId: user.id },
            cache: false,
        });

        if (!examRoom) {
            throw new NotFoundException('Phòng thi không tồn tại');
        }

        // Hard delete - pass userId for proper cache invalidation
        await this.examRoomRepository.delete(id, user.id);

        return { message: 'Xóa phòng thi thành công' };
    }

    async getExamRoomPublicById(id: string) {
        const examRoom = await this.examRoomRepository.findOne({
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
            cache: true,
        });
        if (!examRoom) {
            throw new NotFoundException(
                'Phòng thi không tồn tại hoặc không công khai'
            );
        }
        return examRoom;
    }

    async getExamRooms(user: User, dto: GetExamRoomsDto) {
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

        const result = await this.examRoomRepository.paginate(
            {
                page: dto.page || 1,
                size: dto.limit || 10,
                ...where,
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
                sortBy: 'createdAt',
                sortType: 'desc',
                cache: true,
            },
            user.id
        );

        return {
            examRooms: result.data,
            total: result.total,
            page: result.page,
            limit: result.size,
            totalPages: result.totalPages,
        };
    }

    /**
     * Get all exam rooms for a user without pagination
     * Used for dropdowns and selection lists
     */
    async getAllExamRooms(user: User) {
        const examRooms = await this.prisma.examRoom.findMany({
            where: {
                hostId: user.id,
            },
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
            orderBy: {
                createdAt: 'desc',
            },
        });

        return {
            examRooms,
        };
    }

    async updateExamRoom(id: string, user: User, dto: UpdateExamRoomDto) {
        // Check if exam room exists and belongs to user
        const existingRoom = await this.examRoomRepository.findOne({
            where: { id },
            cache: false,
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
            const quizSet = await this.quizSetRepository.findOne({
                where: { id: dto.quizSetId, userId: user.id },
                cache: true,
            });

            if (!quizSet) {
                throw new NotFoundException(
                    'Bộ câu hỏi không tồn tại hoặc không thuộc về bạn'
                );
            }
        }

        try {
            await this.examRoomRepository.update(
                id,
                {
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
                user.id
            );

            // Load with relations for response
            const updatedExamRoom = await this.examRoomRepository.findOne({
                where: { id },
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
                cache: false,
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
