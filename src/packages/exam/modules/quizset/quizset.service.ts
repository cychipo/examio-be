import { PrismaService } from 'src/prisma/prisma.service';
import {
    Injectable,
    ConflictException,
    NotFoundException,
    InternalServerErrorException,
} from '@nestjs/common';
import { GenerateIdService } from 'src/common/services/generate-id.service';
import { User } from '@prisma/client';
import { CreateQuizsetDto } from './dto/create-quizset.dto';
import { GetQuizsetsDto } from './dto/get-quizset.dto';
import { UpdateQuizSetDto } from './dto/update-quizset.dto';
import { SetQuizzToQuizsetDto } from './dto/set-quizz-to-quizset.dto';

@Injectable()
export class QuizsetService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly generateIdService: GenerateIdService
    ) {}

    async createQuizSet(user: User, dto: CreateQuizsetDto) {
        if (!dto.title || dto.title.trim() === '') {
            throw new ConflictException('Tiêu đề không được để trống');
        }

        try {
            const newQuizSet = await this.prisma.quizSet.create({
                data: {
                    id: this.generateIdService.generateId(),
                    title: dto.title,
                    description: dto.description || '',
                    isPublic: dto.isPublic || false,
                    tags: dto.tags || [],
                    userId: user.id,
                    thumbnail: dto.thumbnail || null,
                },
            });
            return {
                message: 'Tạo bộ câu hỏi thành công',
                quizSet: newQuizSet,
            };
        } catch (error) {
            throw new InternalServerErrorException('Tạo bộ câu hỏi thất bại');
        }
    }

    async getQuizSetById(id: string, user: User) {
        const quizSet = await this.prisma.quizSet.findUnique({
            where: { id, userId: user.id },
            include: {
                detailsQuizQuestions: {
                    include: {
                        quizQuestion: true,
                    },
                },
            },
        });
        if (!quizSet) {
            throw new NotFoundException('Bộ câu hỏi không tồn tại');
        }

        // Transform để trả về questions như cũ
        const { detailsQuizQuestions, ...quizSetData } = quizSet;
        return {
            ...quizSetData,
            questions: detailsQuizQuestions.map(
                (detail) => detail.quizQuestion
            ),
        };
    }

    async deleteQuizSet(id: string, user: User) {
        const result = await this.prisma.quizSet.deleteMany({
            where: {
                id,
                userId: user.id,
            },
        });

        if (result.count === 0) {
            throw new NotFoundException('Bộ câu hỏi không tồn tại');
        }

        return { message: 'Xóa bộ câu hỏi thành công' };
    }

    async getQuizSetPublicById(id: string) {
        const quizSet = await this.prisma.quizSet.findUnique({
            where: { id, isPublic: true },
            include: {
                detailsQuizQuestions: {
                    include: {
                        quizQuestion: true,
                    },
                },
            },
        });
        if (!quizSet) {
            throw new NotFoundException('Bộ câu hỏi không tồn tại');
        }

        // Transform để trả về questions như cũ
        const { detailsQuizQuestions, ...quizSetData } = quizSet;
        return {
            ...quizSetData,
            questions: detailsQuizQuestions.map(
                (detail) => detail.quizQuestion
            ),
        };
    }

    async getQuizSets(user: User, dto: GetQuizsetsDto) {
        const skip = ((dto.page || 1) - 1) * (dto.limit || 10);

        const where: any = {
            userId: user.id,
        };

        if (dto.search) {
            where.OR = [
                { title: { contains: dto.search, mode: 'insensitive' } },
                { description: { contains: dto.search, mode: 'insensitive' } },
            ];
        }

        if (dto.tags && dto.tags.length > 0) {
            where.tags = { hasSome: dto.tags };
        }

        if (dto.isPublic !== undefined) {
            where.isPublic = dto.isPublic;
        }

        if (dto.isPinned !== undefined) {
            where.isPinned = dto.isPinned;
        }

        const [quizSets, total] = await Promise.all([
            this.prisma.quizSet.findMany({
                where,
                skip,
                take: dto.limit || 10,
                orderBy: { createdAt: 'desc' },
            }),
            this.prisma.quizSet.count({ where }),
        ]);

        return {
            quizSets,
            total,
            page: dto.page || 1,
            limit: dto.limit || 10,
            totalPages: Math.ceil(total / (dto.limit || 10)),
        };
    }

    async updateQuizSet(id: string, user: User, dto: UpdateQuizSetDto) {
        try {
            const updatedQuizSet = await this.prisma.quizSet.update({
                where: {
                    id,
                    userId: user.id,
                },
                data: {
                    ...(dto.title && { title: dto.title }),
                    ...(dto.description && { description: dto.description }),
                    ...(dto.isPublic !== undefined && {
                        isPublic: dto.isPublic,
                    }),
                    ...(dto.tags && { tags: dto.tags }),
                    ...(dto.thumbnail && { thumbnail: dto.thumbnail }),
                },
            });

            return {
                message: 'Cập nhật bộ câu hỏi thành công',
                quizSet: updatedQuizSet,
            };
        } catch (error) {
            if (error.code === 'P2025') {
                throw new NotFoundException('Bộ câu hỏi không tồn tại');
            }
            throw new InternalServerErrorException(
                'Cập nhật bộ câu hỏi thất bại'
            );
        }
    }

    async setQuizzsToQuizSet(user: User, dto: SetQuizzToQuizsetDto) {
        try {
            // Validate input
            if (!dto.quizsetIds || dto.quizsetIds.length === 0) {
                throw new ConflictException('Quizset IDs không được để trống');
            }

            if (!dto.quizzes || dto.quizzes.length === 0) {
                throw new ConflictException(
                    'Danh sách câu hỏi không được để trống'
                );
            }

            const result = await this.prisma.$transaction(async (tx) => {
                const quizSets = await tx.quizSet.findMany({
                    where: {
                        id: { in: dto.quizsetIds },
                        userId: user.id,
                    },
                    select: { id: true },
                });

                if (quizSets.length === 0) {
                    throw new NotFoundException(
                        'Không tìm thấy bộ câu hỏi nào'
                    );
                }

                if (quizSets.length !== dto.quizsetIds.length) {
                    throw new NotFoundException(
                        'Một số bộ câu hỏi không tồn tại hoặc không thuộc về bạn'
                    );
                }

                const quizSetIds = quizSets.map((qs) => qs.id);

                const createdQuestions = await Promise.all(
                    dto.quizzes.map(async (quiz) => {
                        const questionId = this.generateIdService.generateId();

                        await tx.quizQuestion.create({
                            data: {
                                id: questionId,
                                question: quiz.question,
                                options: quiz.options,
                                answer: quiz.answer,
                            },
                        });

                        await Promise.all(
                            quizSetIds.map((quizSetId) =>
                                tx.detailsQuizQuestion.create({
                                    data: {
                                        id: this.generateIdService.generateId(),
                                        quizSetId: quizSetId,
                                        quizQuestionId: questionId,
                                    },
                                })
                            )
                        );

                        return questionId;
                    })
                );

                return {
                    createdQuestionsCount: createdQuestions.length,
                    affectedQuizSetsCount: quizSetIds.length,
                };
            });

            return {
                message: `Thêm ${result.createdQuestionsCount} câu hỏi vào ${result.affectedQuizSetsCount} bộ câu hỏi thành công`,
                createdCount: result.createdQuestionsCount,
                affectedQuizSets: result.affectedQuizSetsCount,
            };
        } catch (error) {
            console.log('Error in setQuizzsToQuizSet:', error);
            if (
                error instanceof NotFoundException ||
                error instanceof ConflictException
            ) {
                throw error;
            }
            throw new InternalServerErrorException(
                'Thêm câu hỏi vào bộ câu hỏi thất bại'
            );
        }
    }
}
