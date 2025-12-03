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
import { CreateFlashcardsetDto } from './dto/create-flashcardset.dto';
import { GetFlashcardsetsDto } from './dto/get-flashcardset.dto';
import { UpdateFlashcardSetDto } from './dto/update-flashcardset.dto';
import { SetFlashcardToFlashcardsetDto } from './dto/set-flashcard-to-flashcardset-dto';
import { SaveHistoryToFlashcardsetDto } from './dto/save-history-to-flashcardset.dto';
import { FlashCardSetRepository } from './flashcardset.repository';
import { R2Service } from 'src/packages/r2/r2.service';

@Injectable()
export class FlashcardsetService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly flashcardSetRepository: FlashCardSetRepository,
        private readonly generateIdService: GenerateIdService,
        private readonly r2Service: R2Service
    ) {}

    async createFlashcardSet(
        user: User,
        dto: CreateFlashcardsetDto,
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
                    'flashcardset-thumbnails'
                );
                thumbnailUrl = this.r2Service.getPublicUrl(r2Key);
            }

            const newFlashcardSet = await this.flashcardSetRepository.create(
                {
                    id: this.generateIdService.generateId(),
                    title: dto.title,
                    description: dto.description || '',
                    isPublic:
                        dto.isPublic === true ||
                        dto.isPublic?.toString() === 'true',
                    tag: Array.isArray(dto.tags)
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
                message: 'Tạo bộ thẻ ghi nhớ thành công',
                flashcardSet: newFlashcardSet,
            };
        } catch (error) {
            console.log(error);
            throw new InternalServerErrorException(
                'Tạo bộ thẻ ghi nhớ thất bại'
            );
        }
    }

    async getFlashcardSetStats(user: User) {
        try {
            // Get total count
            const totalCount = await this.prisma.flashCardSet.count({
                where: { userId: user.id },
            });

            // Get total cards count
            const cardCountResult =
                await this.prisma.detailsFlashCard.aggregate({
                    where: {
                        flashCardSet: {
                            userId: user.id,
                        },
                    },
                    _count: true,
                });

            const totalCards = cardCountResult._count || 0;

            return {
                totalGroups: totalCount,
                totalCards,
                avgProgress: 0, // TODO: Implement progress tracking
                studiedToday: 0, // TODO: Implement study tracking
            };
        } catch (error) {
            throw new InternalServerErrorException(
                'Lấy thống kê bộ thẻ ghi nhớ thất bại'
            );
        }
    }

    async getFlashcardSetById(id: string, user: User) {
        const flashcardSet = await this.flashcardSetRepository.findOne({
            where: { id, userId: user.id },
            include: {
                detailsFlashCard: {
                    include: {
                        flashCard: true,
                    },
                },
            },
            cache: true,
        });

        if (!flashcardSet) {
            throw new NotFoundException('Bộ thẻ ghi nhớ không tồn tại');
        }

        // Transform để trả về flashCards như cũ
        const { detailsFlashCard, ...flashcardSetData } = flashcardSet as any;
        return {
            ...flashcardSetData,
            flashCards: detailsFlashCard.map((detail: any) => detail.flashCard),
        };
    }

    async deleteFlashcardSet(id: string, user: User) {
        // Check ownership
        const flashcardSet = await this.flashcardSetRepository.findOne({
            where: { id, userId: user.id },
            cache: false,
        });

        if (!flashcardSet) {
            throw new NotFoundException('Bộ thẻ ghi nhớ không tồn tại');
        }

        // Hard delete - pass userId for proper cache invalidation
        await this.flashcardSetRepository.delete(id, user.id);
        const key = flashcardSet.thumbnail?.replace(/^https?:\/\/[^/]+\//, '');
        if (key) {
            await this.r2Service.deleteFile(key);
        }

        return { message: 'Xóa bộ thẻ ghi nhớ thành công' };
    }

    async getFlashcardSetPublicById(id: string) {
        const flashcardSet = await this.flashcardSetRepository.findOne({
            where: { id, isPublic: true },
            include: {
                detailsFlashCard: {
                    include: {
                        flashCard: true,
                    },
                },
            },
            cache: true,
        });

        if (!flashcardSet) {
            throw new NotFoundException('Bộ thẻ ghi nhớ không tồn tại');
        }

        // Transform để trả về flashCards như cũ
        const { detailsFlashCard, ...flashcardSetData } = flashcardSet as any;
        return {
            ...flashcardSetData,
            flashCards: detailsFlashCard.map((detail: any) => detail.flashCard),
        };
    }

    async getFlashcardSets(user: User, dto: GetFlashcardsetsDto) {
        const where: any = {
            userId: user.id,
        };

        if (dto.search) {
            where.OR = [
                { title: { contains: dto.search, mode: 'insensitive' } },
                { description: { contains: dto.search, mode: 'insensitive' } },
            ];
        }

        if (dto.tag && dto.tag.length > 0) {
            where.tag = { hasSome: dto.tag };
        }

        if (dto.isPublic !== undefined) {
            where.isPublic = dto.isPublic;
        }

        if (dto.isPinned !== undefined) {
            where.isPinned = dto.isPinned;
        }

        // Use repository pagination with cache
        const result = await this.flashcardSetRepository.paginate(
            {
                page: dto.page || 1,
                size: dto.limit || 10,
                ...where,
                include: {
                    _count: { select: { detailsFlashCard: true } },
                },
                sortBy: 'createdAt',
                sortType: 'desc',
                cache: true,
            },
            user.id
        );

        return {
            flashcardSets: result.data,
            total: result.total,
            page: result.page,
            limit: result.size,
            totalPages: result.totalPages,
        };
    }

    async updateFlashcardSet(
        id: string,
        user: User,
        dto: UpdateFlashcardSetDto,
        thumbnailFile?: Express.Multer.File
    ) {
        try {
            // Check ownership
            const flashcardSet = await this.flashcardSetRepository.findOne({
                where: { id, userId: user.id },
                cache: false,
            });

            if (!flashcardSet) {
                throw new NotFoundException('Bộ thẻ ghi nhớ không tồn tại');
            }

            // Handle thumbnail upload if file is provided
            let thumbnailUrl = dto.thumbnail;
            if (thumbnailFile) {
                const fileName = `${Date.now()}-${thumbnailFile.originalname}`;
                const r2Key = await this.r2Service.uploadFile(
                    fileName,
                    thumbnailFile.buffer,
                    thumbnailFile.mimetype,
                    'flashcardset-thumbnails'
                );
                thumbnailUrl = this.r2Service.getPublicUrl(r2Key);
            }

            // Update using repository
            const updatedFlashcardSet =
                await this.flashcardSetRepository.update(
                    id,
                    {
                        ...(dto.title && { title: dto.title }),
                        ...(dto.description && {
                            description: dto.description,
                        }),
                        ...(dto.isPublic !== undefined && {
                            isPublic: dto.isPublic,
                        }),
                        ...(dto.tag && { tag: dto.tag }),
                        ...(thumbnailUrl !== undefined && {
                            thumbnail: thumbnailUrl,
                        }),
                    },
                    user.id
                );

            return {
                message: 'Cập nhật bộ thẻ ghi nhớ thành công',
                flashcardSet: updatedFlashcardSet,
            };
        } catch (error) {
            console.log('Error updating flashcard set:', error);
            if (error instanceof NotFoundException) {
                throw error;
            }
            throw new InternalServerErrorException(
                'Cập nhật bộ thẻ ghi nhớ thất bại'
            );
        }
    }

    async setFlashcardsToFlashcardSet(
        user: User,
        dto: SetFlashcardToFlashcardsetDto
    ) {
        try {
            const result = await this.prisma.$transaction(async (tx) => {
                const flashcardSets = await tx.flashCardSet.findMany({
                    where: {
                        id: { in: dto.flashcardsetIds },
                        userId: user.id,
                    },
                    select: { id: true },
                });

                if (flashcardSets.length === 0) {
                    throw new NotFoundException(
                        'Không tìm thấy bộ thẻ ghi nhớ nào'
                    );
                }

                if (flashcardSets.length !== dto.flashcardsetIds.length) {
                    throw new NotFoundException(
                        'Một số bộ thẻ ghi nhớ không tồn tại hoặc không thuộc về bạn'
                    );
                }

                const flashcardSetIds = flashcardSets.map((fs) => fs.id);

                const createdFlashcards = await Promise.all(
                    dto.flashcards.map(async (flashcard) => {
                        const flashcardId = this.generateIdService.generateId();

                        await tx.flashCard.create({
                            data: {
                                id: flashcardId,
                                question: flashcard.question,
                                answer: flashcard.answer,
                            },
                        });

                        await Promise.all(
                            flashcardSetIds.map((flashcardSetId) =>
                                tx.detailsFlashCard.create({
                                    data: {
                                        id: this.generateIdService.generateId(),
                                        flashCardSetId: flashcardSetId,
                                        flashCardId: flashcardId,
                                    },
                                })
                            )
                        );

                        return flashcardId;
                    })
                );

                return {
                    createdFlashcardsCount: createdFlashcards.length,
                    affectedFlashcardSetsCount: flashcardSetIds.length,
                    affectedFlashcardSetIds: flashcardSetIds,
                };
            });

            // Invalidate caches
            await this.flashcardSetRepository.invalidateUserListCache(user.id);
            for (const id of result.affectedFlashcardSetIds) {
                await this.flashcardSetRepository.invalidateItemCache(
                    user.id,
                    id
                );
            }

            return {
                message: `Thêm ${result.createdFlashcardsCount} thẻ ghi nhớ vào ${result.affectedFlashcardSetsCount} bộ thẻ ghi nhớ thành công`,
                createdCount: result.createdFlashcardsCount,
                affectedFlashcardSets: result.affectedFlashcardSetsCount,
            };
        } catch (error) {
            if (error instanceof NotFoundException) {
                throw error;
            }
            throw new InternalServerErrorException(
                'Thêm thẻ ghi nhớ vào bộ thẻ ghi nhớ thất bại'
            );
        }
    }

    /**
     * Lưu flashcards từ HistoryGeneratedFlashcard vào FlashCardSet
     * - Optimized với batch operations và hash-based deduplication
     * - Check duplicate theo nội dung flashcard (question + answer)
     */
    async saveHistoryToFlashcardSet(
        user: User,
        dto: SaveHistoryToFlashcardsetDto
    ) {
        try {
            // Validate input
            if (!dto.flashcardsetIds || dto.flashcardsetIds.length === 0) {
                throw new BadRequestException(
                    'Flashcardset IDs không được để trống'
                );
            }

            if (!dto.historyId) {
                throw new BadRequestException('History ID không được để trống');
            }

            const result = await this.prisma.$transaction(async (tx) => {
                // Validate flashcardSets thuộc về user
                const flashcardSets = await tx.flashCardSet.findMany({
                    where: {
                        id: { in: dto.flashcardsetIds },
                        userId: user.id,
                    },
                    select: { id: true },
                });

                if (flashcardSets.length === 0) {
                    throw new NotFoundException(
                        'Không tìm thấy bộ thẻ ghi nhớ nào'
                    );
                }

                if (flashcardSets.length !== dto.flashcardsetIds.length) {
                    throw new NotFoundException(
                        'Một số bộ thẻ ghi nhớ không tồn tại hoặc không thuộc về bạn'
                    );
                }

                // Validate history record thuộc về user
                // Support both historyId (id field) and userStorageId for backward compatibility
                const history = await tx.historyGeneratedFlashcard.findFirst({
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

                // Parse flashcards array từ JSON field
                const flashcards = Array.isArray(history.flashcards)
                    ? history.flashcards
                    : [];

                if (flashcards.length === 0) {
                    throw new BadRequestException(
                        'History không có flashcard nào'
                    );
                }

                const flashcardSetIds = flashcardSets.map((fs) => fs.id);

                const existingFlashcards = await tx.detailsFlashCard.findMany({
                    where: {
                        flashCardSetId: { in: flashcardSetIds },
                    },
                    select: {
                        flashCardSetId: true,
                        flashCard: {
                            select: {
                                question: true,
                                answer: true,
                            },
                        },
                    },
                });

                const existingMap = new Map<string, Set<string>>();
                for (const ef of existingFlashcards) {
                    const hash = this.hashFlashcard(
                        ef.flashCard.question,
                        ef.flashCard.answer
                    );
                    if (!existingMap.has(ef.flashCardSetId)) {
                        existingMap.set(ef.flashCardSetId, new Set());
                    }
                    existingMap.get(ef.flashCardSetId)!.add(hash);
                }

                const flashcardsToCreate: any[] = [];
                const detailsToCreate: any[] = [];
                const flashcardIdMap = new Map<string, string>(); // hash -> flashcardId

                let skippedCount = 0;

                for (const flashcard of flashcards) {
                    if (
                        !flashcard ||
                        typeof flashcard !== 'object' ||
                        Array.isArray(flashcard)
                    ) {
                        continue;
                    }

                    const flashcardData = flashcard as {
                        question?: string;
                        answer?: string;
                    };

                    const question = flashcardData.question || '';
                    const answer = flashcardData.answer || '';
                    const hash = this.hashFlashcard(question, answer);

                    // Tạo flashcardId một lần cho mỗi unique flashcard
                    if (!flashcardIdMap.has(hash)) {
                        const flashcardId = this.generateIdService.generateId();
                        flashcardIdMap.set(hash, flashcardId);

                        flashcardsToCreate.push({
                            id: flashcardId,
                            question,
                            answer,
                        });
                    }

                    const flashcardId = flashcardIdMap.get(hash)!;

                    for (const flashcardSetId of flashcardSetIds) {
                        const existingSet = existingMap.get(flashcardSetId);

                        if (existingSet && existingSet.has(hash)) {
                            skippedCount++;
                            continue;
                        }

                        detailsToCreate.push({
                            id: this.generateIdService.generateId(),
                            flashCardSetId: flashcardSetId,
                            flashCardId: flashcardId,
                            historyGeneratedFlashcardId: history.id,
                        });

                        // Update map để tránh duplicate trong cùng batch
                        if (!existingSet) {
                            existingMap.set(flashcardSetId, new Set([hash]));
                        } else {
                            existingSet.add(hash);
                        }
                    }
                }

                if (
                    flashcardsToCreate.length > 0 &&
                    detailsToCreate.length > 0
                ) {
                    await tx.flashCard.createMany({
                        data: flashcardsToCreate,
                        skipDuplicates: true,
                    });
                }

                if (detailsToCreate.length > 0) {
                    await tx.detailsFlashCard.createMany({
                        data: detailsToCreate,
                        skipDuplicates: true,
                    });
                }

                return {
                    createdCount: detailsToCreate.length,
                    skippedCount,
                    totalFlashcards: flashcards.length,
                    affectedFlashcardSetsCount: flashcardSetIds.length,
                    affectedFlashcardSetIds: flashcardSetIds,
                };
            });

            // Invalidate caches
            await this.flashcardSetRepository.invalidateUserListCache(user.id);
            for (const id of result.affectedFlashcardSetIds) {
                await this.flashcardSetRepository.invalidateItemCache(
                    user.id,
                    id
                );
            }

            return {
                message: `Đã lưu ${result.createdCount} thẻ ghi nhớ vào ${result.affectedFlashcardSetsCount} bộ thẻ ghi nhớ${result.skippedCount > 0 ? ` (${result.skippedCount} bỏ qua do trùng lặp)` : ''}`,
                createdCount: result.createdCount,
                skippedCount: result.skippedCount,
                affectedFlashcardSets: result.affectedFlashcardSetsCount,
            };
        } catch (error) {
            console.log('Error in saveHistoryToFlashcardSet:', error);
            if (
                error instanceof NotFoundException ||
                error instanceof BadRequestException
            ) {
                throw error;
            }
            throw new InternalServerErrorException(
                'Lưu thẻ ghi nhớ từ history thất bại'
            );
        }
    }

    private hashFlashcard(question: string, answer: string): string {
        const normalized = `${question.trim().toLowerCase()}|||${answer.trim().toLowerCase()}`;
        return normalized;
    }

    // ==================== FLASHCARD CRUD METHODS ====================

    /**
     * Thêm flashcard vào flashcardset
     */
    async addFlashcardToFlashcardSet(
        flashcardSetId: string,
        user: User,
        dto: { question: string; answer: string }
    ) {
        // Check ownership
        const flashcardSet = await this.flashcardSetRepository.findOne({
            where: { id: flashcardSetId, userId: user.id },
            cache: false,
        });

        if (!flashcardSet) {
            throw new NotFoundException('Bộ thẻ ghi nhớ không tồn tại');
        }

        const flashcardId = this.generateIdService.generateId();

        const flashcard = await this.prisma.$transaction(async (tx) => {
            // Create flashcard
            const newFlashcard = await tx.flashCard.create({
                data: {
                    id: flashcardId,
                    question: dto.question,
                    answer: dto.answer,
                },
            });

            // Create detail link
            await tx.detailsFlashCard.create({
                data: {
                    id: this.generateIdService.generateId(),
                    flashCardSetId: flashcardSetId,
                    flashCardId: flashcardId,
                },
            });

            return newFlashcard;
        });

        // Invalidate all flashcardset caches including paginate caches
        await this.flashcardSetRepository.invalidateCache();

        return {
            message: 'Thêm thẻ ghi nhớ thành công',
            flashcard,
        };
    }

    /**
     * Cập nhật flashcard trong flashcardset
     */
    async updateFlashcardInFlashcardSet(
        flashcardSetId: string,
        flashcardId: string,
        user: User,
        dto: { question?: string; answer?: string }
    ) {
        // Check ownership of flashcardset
        const flashcardSet = await this.flashcardSetRepository.findOne({
            where: { id: flashcardSetId, userId: user.id },
            cache: false,
        });

        if (!flashcardSet) {
            throw new NotFoundException('Bộ thẻ ghi nhớ không tồn tại');
        }

        // Check if flashcard belongs to this flashcardset
        const detailLink = await this.prisma.detailsFlashCard.findFirst({
            where: {
                flashCardSetId: flashcardSetId,
                flashCardId: flashcardId,
            },
        });

        if (!detailLink) {
            throw new NotFoundException(
                'Thẻ ghi nhớ không tồn tại trong bộ này'
            );
        }

        // Update flashcard
        const updatedFlashcard = await this.prisma.flashCard.update({
            where: { id: flashcardId },
            data: {
                ...(dto.question && { question: dto.question }),
                ...(dto.answer && { answer: dto.answer }),
            },
        });

        // Invalidate all flashcardset caches including paginate caches
        await this.flashcardSetRepository.invalidateCache();

        return {
            message: 'Cập nhật thẻ ghi nhớ thành công',
            flashcard: updatedFlashcard,
        };
    }

    /**
     * Xóa flashcard khỏi flashcardset
     */
    async deleteFlashcardFromFlashcardSet(
        flashcardSetId: string,
        flashcardId: string,
        user: User
    ) {
        // Check ownership of flashcardset
        const flashcardSet = await this.flashcardSetRepository.findOne({
            where: { id: flashcardSetId, userId: user.id },
            cache: false,
        });

        if (!flashcardSet) {
            throw new NotFoundException('Bộ thẻ ghi nhớ không tồn tại');
        }

        // Check if flashcard belongs to this flashcardset
        const detailLink = await this.prisma.detailsFlashCard.findFirst({
            where: {
                flashCardSetId: flashcardSetId,
                flashCardId: flashcardId,
            },
        });

        if (!detailLink) {
            throw new NotFoundException(
                'Thẻ ghi nhớ không tồn tại trong bộ này'
            );
        }

        // Delete the link (not the flashcard itself)
        await this.prisma.detailsFlashCard.delete({
            where: { id: detailLink.id },
        });

        // Invalidate all flashcardset caches including paginate caches
        await this.flashcardSetRepository.invalidateCache();

        return {
            message: 'Xóa thẻ ghi nhớ thành công',
        };
    }
}
