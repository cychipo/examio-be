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
import { UpdateSharingSettingsDto } from './dto/sharing.dto';
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
                            participants: true,
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

        return {
            ...examSession,
            questions: examSession.examRoom.quizSet.detailsQuizQuestions.map(
                (d) => d.quizQuestion
            ),
            creator: examSession.examRoom.host,
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
                (d) => d.quizQuestion
            ),
            creator: examSession.examRoom.host,
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
        dto: UpdateSharingSettingsDto
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
}
