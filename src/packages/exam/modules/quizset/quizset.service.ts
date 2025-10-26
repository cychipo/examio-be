import { PrismaService } from 'src/prisma/prisma.service';
import {
    Injectable,
    ConflictException,
    NotFoundException,
    InternalServerErrorException,
    BadRequestException,
} from '@nestjs/common';
import { GenerateIdService } from 'src/common/services/generate-id.service';
import { User } from '@prisma/client';
import { CreateQuizsetDto } from './dto/create-quizset.dto';
import { GetQuizsetsDto } from './dto/get-quizset.dto';
import { UpdateQuizSetDto } from './dto/update-quizset.dto';
import { SetQuizzToQuizsetDto } from './dto/set-quizz-to-quizset.dto';
import { SaveHistoryToQuizsetDto } from './dto/save-history-to-quizset.dto';

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

    /**
     * Lưu câu hỏi từ HistoryGeneratedQuizz vào QuizSet
     * - 1 historyId chứa nhiều quizzes (JSON array)
     * - Lấy tất cả quizzes từ history.quizzes
     * - Tạo QuizQuestion từ mỗi quiz trong array
     * - Tạo DetailsQuizQuestion với historyGeneratedQuizzId để track và prevent duplicate
     * - Constraint @@unique([quizSetId, historyGeneratedQuizzId]) sẽ tự động ngăn lưu trùng
     */
    async saveHistoryToQuizSet(user: User, dto: SaveHistoryToQuizsetDto) {
        try {
            // Validate input
            if (!dto.quizsetIds || dto.quizsetIds.length === 0) {
                throw new BadRequestException(
                    'Quizset IDs không được để trống'
                );
            }

            if (!dto.historyId) {
                throw new BadRequestException('History ID không được để trống');
            }

            const result = await this.prisma.$transaction(async (tx) => {
                // Validate quizSets thuộc về user
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

                // Validate history record thuộc về user
                const history = await tx.historyGeneratedQuizz.findUnique({
                    where: {
                        id: dto.historyId,
                        userId: user.id,
                    },
                });

                if (!history) {
                    throw new NotFoundException(
                        'Không tìm thấy history hoặc không thuộc về bạn'
                    );
                }

                // Parse quizzes array từ JSON field
                const quizzes = Array.isArray(history.quizzes)
                    ? history.quizzes
                    : [];

                if (quizzes.length === 0) {
                    throw new BadRequestException(
                        'History không có câu hỏi nào'
                    );
                }

                const quizSetIds = quizSets.map((qs) => qs.id);
                let createdCount = 0;
                let skippedCount = 0;

                // Kiểm tra history đã được lưu vào quizSet nào chưa
                const existingDetails = await tx.detailsQuizQuestion.findMany({
                    where: {
                        quizSetId: { in: quizSetIds },
                        historyGeneratedQuizzId: dto.historyId,
                    },
                    select: {
                        quizSetId: true,
                    },
                });

                // Tạo Set các quizSetId đã có history này
                const existingQuizSetIds = new Set(
                    existingDetails.map((d) => d.quizSetId)
                );

                // Tạo QuizQuestion cho mỗi quiz trong history
                for (const quiz of quizzes) {
                    if (
                        !quiz ||
                        typeof quiz !== 'object' ||
                        Array.isArray(quiz)
                    ) {
                        continue;
                    }

                    const quizObj = quiz as {
                        question?: string;
                        options?: string[];
                        answer?: string;
                    };

                    const questionId = this.generateIdService.generateId();

                    // Tạo QuizQuestion từ quiz data
                    await tx.quizQuestion.create({
                        data: {
                            id: questionId,
                            question: quizObj.question || '',
                            options: quizObj.options || [],
                            answer: quizObj.answer || '',
                        },
                    });

                    // Tạo DetailsQuizQuestion cho mỗi quizSet chưa có history này
                    for (const quizSetId of quizSetIds) {
                        // Skip nếu quizSet này đã có history này rồi
                        if (existingQuizSetIds.has(quizSetId)) {
                            console.log(
                                `⚠️ History ${history.id} đã được lưu vào QuizSet ${quizSetId} trước đó`
                            );
                            skippedCount++;
                            continue;
                        }

                        await tx.detailsQuizQuestion.create({
                            data: {
                                id: this.generateIdService.generateId(),
                                quizSetId: quizSetId,
                                quizQuestionId: questionId,
                                historyGeneratedQuizzId: history.id,
                            },
                        });
                        createdCount++;
                    }

                    // Sau khi tạo xong quiz này cho tất cả quizSets, mark tất cả là đã có
                    // (để tránh tạo lại cho các quiz tiếp theo trong cùng history)
                    quizSetIds.forEach((id) => existingQuizSetIds.add(id));
                }

                return {
                    createdCount,
                    skippedCount,
                    totalQuizzes: quizzes.length,
                    affectedQuizSetsCount: quizSetIds.length,
                };
            });

            return {
                message: `Đã lưu ${result.totalQuizzes} câu hỏi vào ${result.affectedQuizSetsCount} bộ câu hỏi${result.skippedCount > 0 ? ` (${result.skippedCount} đã tồn tại)` : ''}`,
                createdCount: result.createdCount,
                skippedCount: result.skippedCount,
                affectedQuizSets: result.affectedQuizSetsCount,
            };
        } catch (error) {
            console.log('Error in saveHistoryToQuizSet:', error);
            if (
                error instanceof NotFoundException ||
                error instanceof BadRequestException
            ) {
                throw error;
            }
            throw new InternalServerErrorException(
                'Lưu câu hỏi từ history thất bại'
            );
        }
    }
}
