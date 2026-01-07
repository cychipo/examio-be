import { PrismaService } from '@examio/database';
import {
    Injectable,
    ConflictException,
    Inject,
    NotFoundException,
    InternalServerErrorException,
    BadRequestException,
    ForbiddenException,
} from '@nestjs/common';
import { GenerateIdService } from '@examio/common';
import { User } from '@prisma/client';
import { CreateFlashcardsetDto } from './dto/create-flashcardset.dto';
import { GetFlashcardsetsDto } from './dto/get-flashcardset.dto';
import { UpdateFlashcardSetDto } from './dto/update-flashcardset.dto';
import { SetFlashcardToFlashcardsetDto } from './dto/set-flashcard-to-flashcardset-dto';
import { SaveHistoryToFlashcardsetDto } from './dto/save-history-to-flashcardset.dto';
import { FlashcardSetUpdateSharingSettingsDto } from './dto/sharing.dto';
import {
    CreateFlashcardLabelDto,
    UpdateFlashcardLabelDto,
    AssignFlashcardsToLabelDto,
} from './dto/flashcard-label.dto';
import { FlashCardSetRepository } from './flashcardset.repository';
import { R2ClientService } from '@examio/common';

@Injectable()
export class FlashcardsetService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly flashcardSetRepository: FlashCardSetRepository,
        private readonly generateIdService: GenerateIdService,
        private readonly r2Service: R2ClientService
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
                    isPinned:
                        dto.isPinned === true ||
                        dto.isPinned?.toString() === 'true',
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
            // Transform 'tag' to 'tags' for frontend compatibility
            const { tag, ...rest } = newFlashcardSet as any;
            return {
                message: 'Tạo bộ thẻ ghi nhớ thành công',
                flashcardSet: {
                    ...rest,
                    tags: tag,
                },
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
            // Get total count and total view count in a single query
            const stats = await this.prisma.flashCardSet.aggregate({
                where: { userId: user.id },
                _count: true,
                _sum: { viewCount: true },
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
                totalGroups: stats._count || 0,
                totalCards,
                totalViews: stats._sum?.viewCount || 0,
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

        // Transform để trả về flashCards như cũ và map 'tag' to 'tags'
        const { detailsFlashCard, tag, ...flashcardSetData } =
            flashcardSet as any;
        return {
            ...flashcardSetData,
            tags: tag,
            flashCards: detailsFlashCard.map((detail: any) => detail.flashCard),
        };
    }

    /**
     * Get flashcards with pagination for a flashcard set
     * Tối ưu query bằng cách chỉ lấy flashcards cần thiết theo page/limit
     */
    async getFlashcardSetFlashcards(
        id: string,
        user: User,
        page: number = 1,
        limit: number = 10,
        labelId?: string | null
    ) {
        // Ensure page and limit are numbers (query params come as strings)
        const pageNum = Number(page) || 1;
        const limitNum = Number(limit) || 10;

        // First verify ownership
        const flashcardSet = await this.flashcardSetRepository.findOne({
            where: { id, userId: user.id },
            cache: true,
        });

        if (!flashcardSet) {
            throw new NotFoundException('Bộ thẻ ghi nhớ không tồn tại');
        }

        const skip = (pageNum - 1) * limitNum;

        // Build where condition for filtering
        const whereCondition: any = { flashCardSetId: id };
        if (labelId === 'unlabeled') {
            whereCondition.labelId = null;
        } else if (labelId) {
            whereCondition.labelId = labelId;
        }

        // Get total count
        const totalCount = await this.prisma.detailsFlashCard.count({
            where: whereCondition,
        });

        // Get paginated flashcards - order by flashCard.createdAt
        const detailsFlashCards = await this.prisma.detailsFlashCard.findMany({
            where: whereCondition,
            include: {
                flashCard: true,
                label: true,
            },
            skip,
            take: limitNum,
            orderBy: {
                flashCard: { createdAt: 'asc' },
            },
        });

        const flashCards = detailsFlashCards.map((detail) => detail.flashCard);

        return {
            flashCards,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total: totalCount,
                totalPages: Math.ceil(totalCount / limitNum),
            },
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

        // Transform để trả về flashCards như cũ và map 'tag' to 'tags'
        const { detailsFlashCard, tag, ...flashcardSetData } =
            flashcardSet as any;
        return {
            ...flashcardSetData,
            tags: tag,
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

        // Transform 'tag' to 'tags' for all flashcard sets
        const transformedData = (result.data as any[]).map((fs) => {
            const { tag, ...rest } = fs;
            return { ...rest, tags: tag };
        });

        return {
            flashcardSets: transformedData,
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
            if (
                thumbnailFile &&
                thumbnailFile.buffer &&
                thumbnailFile.buffer.length > 0
            ) {
                const oldThumbnailUrl = flashcardSet.thumbnail;

                const fileName = `${Date.now()}-${thumbnailFile.originalname}`;
                const r2Key = await this.r2Service.uploadFile(
                    fileName,
                    thumbnailFile.buffer,
                    thumbnailFile.mimetype,
                    'flashcardset-thumbnails'
                );
                thumbnailUrl = this.r2Service.getPublicUrl(r2Key);

                // Delete old thumbnail from R2 if it exists
                if (oldThumbnailUrl) {
                    const oldKey = oldThumbnailUrl.replace(
                        /^https?:\/\/[^/]+\//,
                        ''
                    );
                    if (oldKey) {
                        await this.r2Service.deleteFile(oldKey).catch((err) => {
                            console.warn(
                                'Failed to delete old flashcardset thumbnail from R2:',
                                err
                            );
                        });
                    }
                }
            } else if (thumbnailFile) {
                // File was sent but is empty - keep existing thumbnail
                console.warn(
                    'Thumbnail file was sent but has no content, keeping existing thumbnail'
                );
                thumbnailUrl = flashcardSet.thumbnail || undefined;
            }

            // Update using repository
            // Note: DTO is already parsed in controller
            await this.flashcardSetRepository.update(
                id,
                {
                    ...(dto.title && { title: dto.title }),
                    ...(dto.description !== undefined && {
                        description: dto.description,
                    }),
                    ...(dto.isPublic !== undefined && {
                        isPublic: dto.isPublic,
                    }),
                    ...(dto.isPinned !== undefined && {
                        isPinned: dto.isPinned,
                    }),
                    ...(dto.tags !== undefined && { tag: dto.tags }),
                    ...(thumbnailUrl !== undefined &&
                        thumbnailUrl !== '' && {
                            thumbnail: thumbnailUrl,
                        }),
                },
                user.id
            );

            // Fetch updated flashcardset with _count for consistent response with list endpoint
            const updatedFlashcardSet =
                await this.prisma.flashCardSet.findUnique({
                    where: { id },
                    include: {
                        _count: { select: { detailsFlashCard: true } },
                    },
                });

            // Transform 'tag' to 'tags' for frontend compatibility
            const { tag, ...rest } = updatedFlashcardSet as any;
            return {
                message: 'Cập nhật bộ thẻ ghi nhớ thành công',
                flashcardSet: {
                    ...rest,
                    tags: tag,
                },
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

                // Handle label creation/assignment for each flashcardset
                // Create a map of flashcardSetId -> labelId
                const labelMap = new Map<string, string | null>();

                for (const flashcardSetId of flashcardSetIds) {
                    let labelId: string | null = null;

                    // If labelId is provided, validate it belongs to this flashcardset
                    if (dto.labelId) {
                        const existingLabel = await tx.flashCardSetLabel.findFirst({
                            where: { id: dto.labelId, flashCardSetId: flashcardSetId },
                        });
                        if (existingLabel) {
                            labelId = existingLabel.id;
                        }
                    }
                    // If labelName is provided but no labelId, create or find label
                    else if (dto.labelName) {
                        const existingLabel = await tx.flashCardSetLabel.findFirst({
                            where: { flashCardSetId: flashcardSetId, name: dto.labelName },
                        });

                        if (existingLabel) {
                            labelId = existingLabel.id;
                        } else {
                            // Get max order for this flashcardset
                            const maxOrder = await tx.flashCardSetLabel.aggregate({
                                where: { flashCardSetId: flashcardSetId },
                                _max: { order: true },
                            });
                            const newOrder = (maxOrder._max.order ?? -1) + 1;

                            const newLabel = await tx.flashCardSetLabel.create({
                                data: {
                                    id: this.generateIdService.generateId(),
                                    flashCardSetId: flashcardSetId,
                                    name: dto.labelName,
                                    color: dto.labelColor,
                                    order: newOrder,
                                },
                            });
                            labelId = newLabel.id;
                        }
                    }

                    labelMap.set(flashcardSetId, labelId);
                }

                const existingFlashcards = await tx.detailsFlashCard.findMany({
                    where: {
                        flashCardSetId: { in: flashcardSetIds },
                    },
                    select: {
                        flashCardSetId: true,
                        flashCardId: true,
                        labelId: true,
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
                const detailsToUpdate: any[] = []; // For updating labelId of existing flashcards
                const flashcardIdMap = new Map<string, string>(); // hash -> flashcardId

                let skippedCount = 0;
                let updatedCount = 0;

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
                        const targetLabelId = labelMap.get(flashcardSetId) || null;

                        if (existingSet && existingSet.has(hash)) {
                            // Check if labelId needs to be updated for existing flashcard
                            const existingDetail = existingFlashcards.find(
                                ef => ef.flashCardSetId === flashcardSetId &&
                                      ef.flashCard.question === flashcard.question &&
                                      ef.flashCard.answer === flashcard.answer
                            );

                            if (existingDetail && existingDetail.labelId !== targetLabelId) {
                                // Update labelId for existing flashcard
                                detailsToUpdate.push({
                                    flashCardSetId: flashcardSetId,
                                    flashCardId: existingDetail.flashCardId,
                                    labelId: targetLabelId,
                                });
                                updatedCount++;
                            } else {
                                skippedCount++;
                            }
                            continue;
                        }

                        detailsToCreate.push({
                            id: this.generateIdService.generateId(),
                            flashCardSetId: flashcardSetId,
                            flashCardId: flashcardId,
                            historyGeneratedFlashcardId: history.id,
                            labelId: targetLabelId,
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

                // Update existing flashcards with new labelId
                for (const update of detailsToUpdate) {
                    await tx.detailsFlashCard.updateMany({
                        where: {
                            flashCardSetId: update.flashCardSetId,
                            flashCardId: update.flashCardId,
                        },
                        data: {
                            labelId: update.labelId,
                        },
                    });
                }

                return {
                    createdCount: detailsToCreate.length,
                    updatedCount,
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
                message: `Đã lưu ${result.createdCount} thẻ ghi nhớ vào ${result.affectedFlashcardSetsCount} bộ thẻ ghi nhớ${result.updatedCount > 0 ? ` (${result.updatedCount} đã cập nhật nhãn)` : ''}${result.skippedCount > 0 ? ` (${result.skippedCount} bỏ qua do trùng lặp)` : ''}`,
                createdCount: result.createdCount,
                updatedCount: result.updatedCount,
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

    // ==================== SHARING & ACCESS METHODS ====================

    /**
     * Get access info for a flashcard set (public endpoint)
     * O(1) query with indexed accessCode field
     */
    async checkAccess(id: string, userId?: string) {
        const flashcardSet = await this.prisma.flashCardSet.findUnique({
            where: { id },
            select: {
                id: true,
                isPublic: true,
                userId: true,
                accessCode: true,
                whitelist: true,
            },
        });

        if (!flashcardSet) {
            throw new NotFoundException('Bộ thẻ ghi nhớ không tồn tại');
        }

        // Public access
        if (flashcardSet.isPublic) {
            return {
                hasAccess: true,
                accessType: 'public' as const,
            };
        }

        // Owner access
        if (userId && flashcardSet.userId === userId) {
            return {
                hasAccess: true,
                accessType: 'owner' as const,
            };
        }

        // Whitelist access
        if (userId && flashcardSet.whitelist.includes(userId)) {
            return {
                hasAccess: true,
                accessType: 'whitelist' as const,
            };
        }

        // Code required
        if (flashcardSet.accessCode) {
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
     * Verify access code for a private flashcard set
     * O(1) indexed lookup
     */
    async verifyAccessCode(id: string, accessCode: string) {
        const flashcardSet = await this.prisma.flashCardSet.findUnique({
            where: { id },
            select: { accessCode: true },
        });

        if (!flashcardSet) {
            throw new NotFoundException('Bộ thẻ ghi nhớ không tồn tại');
        }

        if (flashcardSet.accessCode?.toString() !== accessCode) {
            throw new ForbiddenException('Mã truy cập không đúng');
        }

        return {
            valid: true,
            message: 'Mã xác thực hợp lệ',
        };
    }

    /**
     * Get flashcard set for study (with access check)
     * Returns flashcards + creator info
     */
    async getFlashcardSetForStudy(id: string, userId?: string) {
        // First check access
        const accessInfo = await this.checkAccess(id, userId);

        if (
            !accessInfo.hasAccess &&
            accessInfo.accessType !== 'code_required'
        ) {
            throw new ForbiddenException(
                'Bạn không có quyền truy cập bộ thẻ này'
            );
        }

        if (accessInfo.accessType === 'code_required') {
            throw new ForbiddenException('Yêu cầu mã truy cập');
        }

        // Increment view count atomically
        const flashcardSet = await this.prisma.flashCardSet.update({
            where: { id },
            data: { viewCount: { increment: 1 } },
            include: {
                user: {
                    select: {
                        id: true,
                        username: true,
                        name: true,
                        avatar: true,
                    },
                },
                detailsFlashCard: {
                    include: {
                        flashCard: true,
                    },
                },
                _count: {
                    select: { detailsFlashCard: true },
                },
            },
        });

        const { detailsFlashCard, user, _count, ...flashcardSetData } =
            flashcardSet;

        return {
            ...flashcardSetData,
            flashCards: detailsFlashCard.map((detail) => detail.flashCard),
            cardCount: _count.detailsFlashCard,
            creator: user,
        };
    }

    /**
     * Get flashcard set after code verification
     */
    async getFlashcardSetWithCode(id: string, accessCode: string) {
        // Verify code first
        await this.verifyAccessCode(id, accessCode);

        // Increment view count atomically
        const flashcardSet = await this.prisma.flashCardSet.update({
            where: { id },
            data: { viewCount: { increment: 1 } },
            include: {
                user: {
                    select: {
                        id: true,
                        username: true,
                        name: true,
                        avatar: true,
                    },
                },
                detailsFlashCard: {
                    include: {
                        flashCard: true,
                    },
                },
                _count: {
                    select: { detailsFlashCard: true },
                },
            },
        });

        const { detailsFlashCard, user, _count, ...flashcardSetData } =
            flashcardSet;

        return {
            ...flashcardSetData,
            flashCards: detailsFlashCard.map((detail) => detail.flashCard),
            cardCount: _count.detailsFlashCard,
            creator: user,
        };
    }

    /**
     * Get public info for a flashcard set (without flashcards)
     */
    async getFlashcardSetPublicInfo(id: string) {
        const flashcardSet = await this.prisma.flashCardSet.findUnique({
            where: { id },
            select: {
                id: true,
                title: true,
                description: true,
                thumbnail: true,
                viewCount: true,
                isPublic: true,
                accessCode: true,
                createdAt: true,
                user: {
                    select: {
                        id: true,
                        username: true,
                        name: true,
                        avatar: true,
                    },
                },
                _count: {
                    select: { detailsFlashCard: true },
                },
            },
        });

        if (!flashcardSet) {
            throw new NotFoundException('Bộ thẻ ghi nhớ không tồn tại');
        }

        return {
            id: flashcardSet.id,
            title: flashcardSet.title,
            description: flashcardSet.description,
            thumbnail: flashcardSet.thumbnail,
            viewCount: flashcardSet.viewCount,
            cardCount: flashcardSet._count.detailsFlashCard,
            creator: flashcardSet.user,
            createdAt: flashcardSet.createdAt.toISOString(),
            isPublic: flashcardSet.isPublic,
            requiresCode: !flashcardSet.isPublic && !!flashcardSet.accessCode,
        };
    }

    /**
     * Update sharing settings for a flashcard set
     */
    async updateSharingSettings(
        id: string,
        user: User,
        dto: FlashcardSetUpdateSharingSettingsDto
    ) {
        // Check ownership
        const flashcardSet = await this.flashcardSetRepository.findOne({
            where: { id, userId: user.id },
            cache: false,
        });

        if (!flashcardSet) {
            throw new NotFoundException('Bộ thẻ ghi nhớ không tồn tại');
        }

        // Update sharing settings
        const updatedFlashcardSet = await this.prisma.flashCardSet.update({
            where: { id },
            data: {
                isPublic: dto.isPublic,
                accessCode: dto.isPublic ? null : dto.accessCode,
                whitelist: dto.isPublic ? [] : dto.whitelist || [],
            },
            select: {
                id: true,
                isPublic: true,
                accessCode: true,
                whitelist: true,
            },
        });

        // Invalidate cache
        await this.flashcardSetRepository.invalidateItemCache(user.id, id);

        return {
            message: 'Cập nhật cài đặt chia sẻ thành công',
            isPublic: updatedFlashcardSet.isPublic,
            accessCode: updatedFlashcardSet.accessCode,
            whitelist: updatedFlashcardSet.whitelist,
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
        const flashcardSet = await this.prisma.flashCardSet.findFirst({
            where: { id, userId: user.id },
            select: {
                id: true,
                isPublic: true,
                accessCode: true,
                whitelist: true,
            },
        });

        if (!flashcardSet) {
            throw new NotFoundException('Bộ thẻ ghi nhớ không tồn tại');
        }

        const users = await this.prisma.user.findMany({
            where: {
                id: {
                    in: flashcardSet.whitelist,
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
            ...flashcardSet,
            whitelist: users,
        };
    }

    /**
     * Search users by username for whitelist
     * Excludes the current user
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

    /**
     * Get all labels for a flashcard set
     */
    async getLabels(flashcardSetId: string, user: User) {
        // Check ownership
        const flashcardSet = await this.flashcardSetRepository.findOne({
            where: { id: flashcardSetId, userId: user.id },
            cache: true,
        });

        if (!flashcardSet) {
            throw new NotFoundException('Bộ thẻ ghi nhớ không tồn tại');
        }

        const labels = await this.prisma.flashCardSetLabel.findMany({
            where: { flashCardSetId: flashcardSetId },
            include: {
                _count: {
                    select: { detailsFlashCards: true },
                },
            },
            orderBy: { order: 'asc' },
        });

        // Also get count of unlabeled flashcards
        const unlabeledCount = await this.prisma.detailsFlashCard.count({
            where: { flashCardSetId: flashcardSetId, labelId: null },
        });

        return {
            labels: labels.map((l) => ({
                ...l,
                flashcardCount: l._count.detailsFlashCards,
            })),
            unlabeledCount,
        };
    }

    /**
     * Create a new label for a flashcard set
     */
    async createLabel(
        flashcardSetId: string,
        user: User,
        dto: CreateFlashcardLabelDto
    ) {
        // Check ownership
        const flashcardSet = await this.flashcardSetRepository.findOne({
            where: { id: flashcardSetId, userId: user.id },
        });

        if (!flashcardSet) {
            throw new NotFoundException('Bộ thẻ ghi nhớ không tồn tại');
        }

        const label = await this.prisma.flashCardSetLabel.create({
            data: {
                flashCardSetId: flashcardSetId,
                name: dto.name,
                description: dto.description,
                color: dto.color,
                order: dto.order || 0,
            },
        });

        return { label };
    }

    /**
     * Update a label
     */
    async updateLabel(
        flashcardSetId: string,
        labelId: string,
        user: User,
        dto: UpdateFlashcardLabelDto
    ) {
        // Check ownership
        const flashcardSet = await this.flashcardSetRepository.findOne({
            where: { id: flashcardSetId, userId: user.id },
        });

        if (!flashcardSet) {
            throw new NotFoundException('Bộ thẻ ghi nhớ không tồn tại');
        }

        const label = await this.prisma.flashCardSetLabel.findFirst({
            where: { id: labelId, flashCardSetId: flashcardSetId },
        });

        if (!label) {
            throw new NotFoundException('Nhãn không tồn tại');
        }

        const updatedLabel = await this.prisma.flashCardSetLabel.update({
            where: { id: labelId },
            data: {
                name: dto.name,
                description: dto.description,
                color: dto.color,
                order: dto.order,
            },
        });

        return { label: updatedLabel };
    }

    /**
     * Delete a label
     */
    async deleteLabel(flashcardSetId: string, labelId: string, user: User) {
        // Check ownership
        const flashcardSet = await this.flashcardSetRepository.findOne({
            where: { id: flashcardSetId, userId: user.id },
        });

        if (!flashcardSet) {
            throw new NotFoundException('Bộ thẻ ghi nhớ không tồn tại');
        }

        const label = await this.prisma.flashCardSetLabel.findFirst({
            where: { id: labelId, flashCardSetId: flashcardSetId },
        });

        if (!label) {
            throw new NotFoundException('Nhãn không tồn tại');
        }

        // Remove label from all flashcards
        await this.prisma.detailsFlashCard.updateMany({
            where: { labelId },
            data: { labelId: null },
        });

        // Delete the label
        await this.prisma.flashCardSetLabel.delete({
            where: { id: labelId },
        });

        return { message: 'Nhãn đã được xóa thành công' };
    }

    /**
     * Assign flashcards to a label
     */
    async assignFlashcardsToLabel(
        flashcardSetId: string,
        labelId: string,
        user: User,
        flashcardIds: string[]
    ) {
        // Check ownership
        const flashcardSet = await this.flashcardSetRepository.findOne({
            where: { id: flashcardSetId, userId: user.id },
        });

        if (!flashcardSet) {
            throw new NotFoundException('Bộ thẻ ghi nhớ không tồn tại');
        }

        const label = await this.prisma.flashCardSetLabel.findFirst({
            where: { id: labelId, flashCardSetId: flashcardSetId },
        });

        if (!label) {
            throw new NotFoundException('Nhãn không tồn tại');
        }

        // Verify all flashcards belong to this flashcard set
        const flashcards = await this.prisma.detailsFlashCard.findMany({
            where: {
                id: { in: flashcardIds },
                flashCardSetId: flashcardSetId,
            },
        });

        if (flashcards.length !== flashcardIds.length) {
            throw new BadRequestException('Một số thẻ ghi nhớ không tồn tại hoặc không thuộc bộ này');
        }

        // Assign label to flashcards
        await this.prisma.detailsFlashCard.updateMany({
            where: { id: { in: flashcardIds } },
            data: { labelId },
        });

        return { message: 'Thẻ ghi nhớ đã được gán nhãn thành công' };
    }

    /**
     * Remove flashcards from a label
     */
    async removeFlashcardsFromLabel(
        flashcardSetId: string,
        labelId: string,
        user: User,
        flashcardIds: string[]
    ) {
        // Check ownership
        const flashcardSet = await this.flashcardSetRepository.findOne({
            where: { id: flashcardSetId, userId: user.id },
        });

        if (!flashcardSet) {
            throw new NotFoundException('Bộ thẻ ghi nhớ không tồn tại');
        }

        const label = await this.prisma.flashCardSetLabel.findFirst({
            where: { id: labelId, flashCardSetId: flashcardSetId },
        });

        if (!label) {
            throw new NotFoundException('Nhãn không tồn tại');
        }

        // Remove label from flashcards
        await this.prisma.detailsFlashCard.updateMany({
            where: { id: { in: flashcardIds } },
            data: { labelId: null },
        });

        return { message: 'Đã gỡ nhãn khỏi thẻ ghi nhớ thành công' };
    }

    /**
     * Get flashcards by label
     */
    async getFlashcardsByLabel(
        flashcardSetId: string,
        labelId: string,
        user: User,
        query: any
    ) {
        // Check ownership
        const flashcardSet = await this.flashcardSetRepository.findOne({
            where: { id: flashcardSetId, userId: user.id },
        });

        if (!flashcardSet) {
            throw new NotFoundException('Bộ thẻ ghi nhớ không tồn tại');
        }

        const label = await this.prisma.flashCardSetLabel.findFirst({
            where: { id: labelId, flashCardSetId: flashcardSetId },
        });

        if (!label) {
            throw new NotFoundException('Nhãn không tồn tại');
        }

        const page = query.page || 1;
        const limit = query.limit || 10;
        const skip = (page - 1) * limit;

        const [flashcards, total] = await Promise.all([
            this.prisma.detailsFlashCard.findMany({
                where: { flashCardSetId: flashcardSetId, labelId },
                include: {
                    flashCard: true,
                    label: true,
                },
                skip,
                take: limit,
                orderBy: { id: 'asc' },
            }),
            this.prisma.detailsFlashCard.count({
                where: { flashCardSetId: flashcardSetId, labelId },
            }),
        ]);

        const flashCards = flashcards.map((detail) => ({
            ...detail.flashCard,
            label: detail.label,
        }));

        return {
            flashCards: flashCards,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    }
}
