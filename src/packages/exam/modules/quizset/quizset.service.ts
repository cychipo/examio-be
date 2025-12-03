import { PrismaService } from 'src/prisma/prisma.service';
import {
    BadRequestException,
    ConflictException,
    Injectable,
    InternalServerErrorException,
    NotFoundException,
} from '@nestjs/common';
import { GenerateIdService } from 'src/common/services/generate-id.service';
import { User } from '@prisma/client';
import { CreateQuizsetDto } from './dto/create-quizset.dto';
import { GetQuizsetsDto } from './dto/get-quizset.dto';
import { UpdateQuizSetDto } from './dto/update-quizset.dto';
import { SetQuizzToQuizsetDto } from './dto/set-quizz-to-quizset.dto';
import { SaveHistoryToQuizsetDto } from './dto/save-history-to-quizset.dto';
import { QuizSetRepository } from './quizset.repository';
import { EXPIRED_TIME } from '../../../../constants/redis';
import { R2Service } from 'src/packages/r2/r2.service';

@Injectable()
export class QuizsetService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly quizSetRepository: QuizSetRepository,
        private readonly generateIdService: GenerateIdService,
        private readonly r2Service: R2Service
    ) {}

    async createQuizSet(
        user: User,
        dto: CreateQuizsetDto,
        thumbnailFile?: Express.Multer.File
    ) {
        if (!dto.title || dto.title.trim() === '') {
            throw new ConflictException('Tiêu đề không được để trống');
        }

        try {
            // Handle thumbnail upload if file is provided
            let thumbnailUrl = dto.thumbnail || null;
            if (thumbnailFile) {
                const fileName = `${Date.now()}-${thumbnailFile.originalname}`;
                const r2Key = await this.r2Service.uploadFile(
                    fileName,
                    thumbnailFile.buffer,
                    thumbnailFile.mimetype,
                    'quizset-thumbnails'
                );
                thumbnailUrl = this.r2Service.getPublicUrl(r2Key);
            }

            // Use repository to create quizset
            const newQuizSet = await this.quizSetRepository.create(
                {
                    id: this.generateIdService.generateId(),
                    title: dto.title,
                    description: dto.description || '',
                    isPublic:
                        dto.isPublic === true ||
                        dto.isPublic?.toString() === 'true',
                    tags: Array.isArray(dto.tags)
                        ? dto.tags
                        : typeof dto.tags === 'string'
                          ? JSON.parse(dto.tags)
                          : [],
                    userId: user.id,
                    thumbnail: thumbnailUrl,
                },
                user.id
            );

            return {
                message: 'Tạo bộ câu hỏi thành công',
                quizSet: newQuizSet,
            };
        } catch (error) {
            console.log(error);
            throw new InternalServerErrorException('Tạo bộ câu hỏi thất bại');
        }
    }

    async getQuizSetStats(user: User) {
        try {
            // Get total count
            const totalCount = await this.prisma.quizSet.count({
                where: { userId: user.id },
            });

            // Get active (public) count
            const activeCount = await this.prisma.quizSet.count({
                where: { userId: user.id, isPublic: true },
            });

            // Get total questions count
            const questionCountResult =
                await this.prisma.detailsQuizQuestion.aggregate({
                    where: {
                        quizSet: {
                            userId: user.id,
                        },
                    },
                    _count: true,
                });

            const totalQuestions = questionCountResult._count || 0;

            return {
                totalExams: totalCount,
                activeExams: activeCount,
                totalQuestions,
                completionRate: 0, // TODO: Implement completion tracking
            };
        } catch (error) {
            throw new InternalServerErrorException(
                'Lấy thống kê bộ câu hỏi thất bại'
            );
        }
    }

    async getQuizSetById(id: string, user: User) {
        // Use repository with cache
        const quizSet = await this.quizSetRepository.findOne({
            where: { id, userId: user.id },
            include: {
                detailsQuizQuestions: {
                    include: {
                        quizQuestion: true,
                    },
                },
            },
            cache: true, // Enable cache
        });

        if (!quizSet) {
            throw new NotFoundException('Bộ câu hỏi không tồn tại');
        }

        // Transform để trả về questions như cũ
        const { detailsQuizQuestions, ...quizSetData } = quizSet as any;
        return {
            ...quizSetData,
            questions: detailsQuizQuestions.map(
                (detail: any) => detail.quizQuestion
            ),
        };
    }

    async deleteQuizSet(id: string, user: User) {
        // Check ownership first
        const quizSet = await this.quizSetRepository.findOne({
            where: { id, userId: user.id },
            cache: false,
        });

        if (!quizSet) {
            throw new NotFoundException('Bộ câu hỏi không tồn tại');
        }

        // Hard delete using repository - pass userId for proper cache invalidation
        await this.quizSetRepository.delete(id, user.id);
        const key = quizSet.thumbnail?.replace(/^https?:\/\/[^/]+\//, '');
        if (key) {
            await this.r2Service.deleteFile(key);
        }

        return { message: 'Xóa bộ câu hỏi thành công' };
    }

    async getQuizSetPublicById(id: string) {
        // Use repository with cache for public quizsets
        const quizSet = await this.quizSetRepository.findOne({
            where: { id, isPublic: true },
            include: {
                detailsQuizQuestions: {
                    include: {
                        quizQuestion: true,
                    },
                },
            },
            cache: true,
        });

        if (!quizSet) {
            throw new NotFoundException('Bộ câu hỏi không tồn tại');
        }

        // Transform để trả về questions như cũ
        const { detailsQuizQuestions, ...quizSetData } = quizSet as any;
        return {
            ...quizSetData,
            questions: detailsQuizQuestions.map(
                (detail: any) => detail.quizQuestion
            ),
        };
    }

    async getQuizSets(user: User, dto: GetQuizsetsDto) {
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

        // Use repository pagination with cache and include a count of questions
        const result = await this.quizSetRepository.paginate(
            {
                page: dto.page || 1,
                size: dto.limit || 10,
                ...where,
                include: {
                    _count: {
                        select: {
                            detailsQuizQuestions: true,
                        },
                    },
                },
                sortBy: 'createdAt',
                sortType: 'desc',
                cache: true,
                cacheTTL: EXPIRED_TIME.TEN_MINUTES,
            },
            user.id
        );

        // Map the returned data to expose a flat `questionCount` property per quiz set
        const quizSetsWithCount = (result.data as any[]).map((qs) => ({
            ...qs,
            questionCount: qs._count?.detailsQuizQuestions ?? 0,
        }));

        return {
            quizSets: quizSetsWithCount,
            total: result.total,
            page: result.page,
            limit: result.size,
            totalPages: result.totalPages,
        };
    }

    async updateQuizSet(
        id: string,
        user: User,
        dto: UpdateQuizSetDto,
        thumbnailFile?: Express.Multer.File
    ) {
        try {
            // Check ownership first
            const quizSet = await this.quizSetRepository.findOne({
                where: { id, userId: user.id },
                cache: false,
            });

            if (!quizSet) {
                throw new NotFoundException('Bộ câu hỏi không tồn tại');
            }

            // Handle thumbnail upload if file is provided
            let thumbnailUrl = dto.thumbnail;
            if (thumbnailFile) {
                const fileName = `${Date.now()}-${thumbnailFile.originalname}`;
                const r2Key = await this.r2Service.uploadFile(
                    fileName,
                    thumbnailFile.buffer,
                    thumbnailFile.mimetype,
                    'quizset-thumbnails'
                );
                thumbnailUrl = this.r2Service.getPublicUrl(r2Key);
            }

            // Update using repository (auto invalidate cache)
            const updatedQuizSet = await this.quizSetRepository.update(
                id,
                {
                    ...(dto.title && { title: dto.title }),
                    ...(dto.description && { description: dto.description }),
                    ...(dto.isPublic !== undefined && {
                        isPublic: dto.isPublic,
                    }),
                    ...(dto.tags && { tags: dto.tags }),
                    ...(thumbnailUrl !== undefined && {
                        thumbnail: thumbnailUrl,
                    }),
                },
                user.id
            );

            return {
                message: 'Cập nhật bộ câu hỏi thành công',
                quizSet: updatedQuizSet,
            };
        } catch (error) {
            if (error instanceof NotFoundException) {
                throw error;
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
                // Check quizsets ownership
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
                    affectedQuizSetIds: quizSetIds,
                };
            });

            // Invalidate caches
            await this.quizSetRepository.invalidateUserListCache(user.id);
            for (const id of result.affectedQuizSetIds) {
                await this.quizSetRepository.invalidateItemCache(user.id, id);
            }

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
                // Support both historyId (id field) and userStorageId for backward compatibility
                const history = await tx.historyGeneratedQuizz.findFirst({
                    where: {
                        OR: [
                            { id: dto.historyId },
                            { userStorageId: dto.historyId },
                        ],
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
                const existingQuestions = await tx.detailsQuizQuestion.findMany(
                    {
                        where: {
                            quizSetId: { in: quizSetIds },
                        },
                        select: {
                            quizSetId: true,
                            quizQuestion: {
                                select: {
                                    question: true,
                                    answer: true,
                                },
                            },
                        },
                    }
                );

                const existingMap = new Map<string, Set<string>>();
                for (const eq of existingQuestions) {
                    const hash = this.hashQuestion(
                        eq.quizQuestion.question,
                        eq.quizQuestion.answer
                    );
                    if (!existingMap.has(eq.quizSetId)) {
                        existingMap.set(eq.quizSetId, new Set());
                    }
                    existingMap.get(eq.quizSetId)!.add(hash);
                }

                const questionsToCreate: any[] = [];
                const detailsToCreate: any[] = [];
                const questionIdMap = new Map<string, string>(); // hash -> questionId

                let skippedCount = 0;

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

                    const question = quizObj.question || '';
                    const answer = quizObj.answer || '';
                    const options = quizObj.options || [];
                    const hash = this.hashQuestion(question, answer);

                    if (!questionIdMap.has(hash)) {
                        const questionId = this.generateIdService.generateId();
                        questionIdMap.set(hash, questionId);

                        questionsToCreate.push({
                            id: questionId,
                            question,
                            options,
                            answer,
                        });
                    }

                    const questionId = questionIdMap.get(hash)!;

                    for (const quizSetId of quizSetIds) {
                        const existingSet = existingMap.get(quizSetId);

                        if (existingSet && existingSet.has(hash)) {
                            skippedCount++;
                            continue;
                        }

                        detailsToCreate.push({
                            id: this.generateIdService.generateId(),
                            quizSetId,
                            quizQuestionId: questionId,
                            historyGeneratedQuizzId: history.id,
                        });

                        if (!existingSet) {
                            existingMap.set(quizSetId, new Set([hash]));
                        } else {
                            existingSet.add(hash);
                        }
                    }
                }
                if (
                    questionsToCreate.length > 0 &&
                    detailsToCreate.length > 0
                ) {
                    await tx.quizQuestion.createMany({
                        data: questionsToCreate,
                        skipDuplicates: true,
                    });
                }

                if (detailsToCreate.length > 0) {
                    await tx.detailsQuizQuestion.createMany({
                        data: detailsToCreate,
                        skipDuplicates: true,
                    });
                }

                return {
                    createdCount: detailsToCreate.length,
                    skippedCount,
                    totalQuizzes: quizzes.length,
                    affectedQuizSetsCount: quizSetIds.length,
                    affectedQuizSetIds: quizSetIds,
                };
            });

            // Invalidate caches
            await this.quizSetRepository.invalidateUserListCache(user.id);
            for (const id of result.affectedQuizSetIds) {
                await this.quizSetRepository.invalidateItemCache(user.id, id);
            }

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

    private hashQuestion(question: string, answer: string): string {
        const normalized = `${question.trim().toLowerCase()}|||${answer.trim().toLowerCase()}`;
        return normalized;
    }

    // ==================== QUESTION CRUD METHODS ====================

    /**
     * Thêm câu hỏi vào quizset
     */
    async addQuestionToQuizSet(
        quizSetId: string,
        user: User,
        dto: { question: string; options: string[]; answer: string }
    ) {
        // Check ownership
        const quizSet = await this.quizSetRepository.findOne({
            where: { id: quizSetId, userId: user.id },
            cache: false,
        });

        if (!quizSet) {
            throw new NotFoundException('Bộ câu hỏi không tồn tại');
        }

        const questionId = this.generateIdService.generateId();

        const question = await this.prisma.$transaction(async (tx) => {
            // Create question
            const newQuestion = await tx.quizQuestion.create({
                data: {
                    id: questionId,
                    question: dto.question,
                    options: dto.options,
                    answer: dto.answer,
                },
            });

            // Create detail link
            await tx.detailsQuizQuestion.create({
                data: {
                    id: this.generateIdService.generateId(),
                    quizSetId: quizSetId,
                    quizQuestionId: questionId,
                },
            });

            return newQuestion;
        });

        // Invalidate all quizset caches including paginate caches
        await this.quizSetRepository.invalidateCache();

        return {
            message: 'Thêm câu hỏi thành công',
            question,
        };
    }

    /**
     * Cập nhật câu hỏi trong quizset
     */
    async updateQuestionInQuizSet(
        quizSetId: string,
        questionId: string,
        user: User,
        dto: { question?: string; options?: string[]; answer?: string }
    ) {
        // Check ownership of quizset
        const quizSet = await this.quizSetRepository.findOne({
            where: { id: quizSetId, userId: user.id },
            cache: false,
        });

        if (!quizSet) {
            throw new NotFoundException('Bộ câu hỏi không tồn tại');
        }

        // Check if question belongs to this quizset
        const detailLink = await this.prisma.detailsQuizQuestion.findFirst({
            where: {
                quizSetId: quizSetId,
                quizQuestionId: questionId,
            },
        });

        if (!detailLink) {
            throw new NotFoundException(
                'Câu hỏi không tồn tại trong bộ đề này'
            );
        }

        // Update question
        const updatedQuestion = await this.prisma.quizQuestion.update({
            where: { id: questionId },
            data: {
                ...(dto.question && { question: dto.question }),
                ...(dto.options && { options: dto.options }),
                ...(dto.answer && { answer: dto.answer }),
            },
        });

        // Invalidate all quizset caches including paginate caches
        await this.quizSetRepository.invalidateCache();

        return {
            message: 'Cập nhật câu hỏi thành công',
            question: updatedQuestion,
        };
    }

    /**
     * Xóa câu hỏi khỏi quizset
     */
    async deleteQuestionFromQuizSet(
        quizSetId: string,
        questionId: string,
        user: User
    ) {
        // Check ownership of quizset
        const quizSet = await this.quizSetRepository.findOne({
            where: { id: quizSetId, userId: user.id },
            cache: false,
        });

        if (!quizSet) {
            throw new NotFoundException('Bộ câu hỏi không tồn tại');
        }

        // Check if question belongs to this quizset
        const detailLink = await this.prisma.detailsQuizQuestion.findFirst({
            where: {
                quizSetId: quizSetId,
                quizQuestionId: questionId,
            },
        });

        if (!detailLink) {
            throw new NotFoundException(
                'Câu hỏi không tồn tại trong bộ đề này'
            );
        }

        // Delete the link (not the question itself, as it might be used in other quizsets)
        await this.prisma.detailsQuizQuestion.delete({
            where: { id: detailLink.id },
        });

        // Invalidate all quizset caches including paginate caches
        await this.quizSetRepository.invalidateCache();

        return {
            message: 'Xóa câu hỏi thành công',
        };
    }
}
