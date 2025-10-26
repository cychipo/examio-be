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

@Injectable()
export class FlashcardsetService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly generateIdService: GenerateIdService
    ) {}

    async createFlashcardSet(user: User, dto: CreateFlashcardsetDto) {
        if (!dto.title || dto.title.trim() === '') {
            throw new ConflictException('Tiêu đề không được để trống');
        }

        try {
            const newFlashcardSet = await this.prisma.flashCardSet.create({
                data: {
                    id: this.generateIdService.generateId(),
                    title: dto.title,
                    description: dto.description || '',
                    isPublic: dto.isPublic || false,
                    tag: dto.tag || [],
                    userId: user.id,
                    thumbnail: dto.thumbnail || null,
                },
            });
            return {
                message: 'Tạo bộ thẻ ghi nhớ thành công',
                flashcardSet: newFlashcardSet,
            };
        } catch (error) {
            throw new InternalServerErrorException(
                'Tạo bộ thẻ ghi nhớ thất bại'
            );
        }
    }

    async getFlashcardSetById(id: string, user: User) {
        const flashcardSet = await this.prisma.flashCardSet.findUnique({
            where: { id, userId: user.id },
            include: {
                detailsFlashCard: {
                    include: {
                        flashCard: true,
                    },
                },
            },
        });
        if (!flashcardSet) {
            throw new NotFoundException('Bộ thẻ ghi nhớ không tồn tại');
        }

        // Transform để trả về flashCards như cũ
        const { detailsFlashCard, ...flashcardSetData } = flashcardSet;
        return {
            ...flashcardSetData,
            flashCards: detailsFlashCard.map((detail) => detail.flashCard),
        };
    }

    async deleteFlashcardSet(id: string, user: User) {
        const result = await this.prisma.flashCardSet.deleteMany({
            where: {
                id,
                userId: user.id,
            },
        });

        if (result.count === 0) {
            throw new NotFoundException('Bộ thẻ ghi nhớ không tồn tại');
        }

        return { message: 'Xóa bộ thẻ ghi nhớ thành công' };
    }

    async getFlashcardSetPublicById(id: string) {
        const flashcardSet = await this.prisma.flashCardSet.findUnique({
            where: { id, isPublic: true },
            include: {
                detailsFlashCard: {
                    include: {
                        flashCard: true,
                    },
                },
            },
        });
        if (!flashcardSet) {
            throw new NotFoundException('Bộ thẻ ghi nhớ không tồn tại');
        }

        // Transform để trả về flashCards như cũ
        const { detailsFlashCard, ...flashcardSetData } = flashcardSet;
        return {
            ...flashcardSetData,
            flashCards: detailsFlashCard.map((detail) => detail.flashCard),
        };
    }

    async getFlashcardSets(user: User, dto: GetFlashcardsetsDto) {
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

        if (dto.tag && dto.tag.length > 0) {
            where.tag = { hasSome: dto.tag };
        }

        if (dto.isPublic !== undefined) {
            where.isPublic = dto.isPublic;
        }

        if (dto.isPinned !== undefined) {
            where.isPinned = dto.isPinned;
        }

        const [flashcardSets, total] = await Promise.all([
            this.prisma.flashCardSet.findMany({
                where,
                skip,
                take: dto.limit || 10,
                orderBy: { createdAt: 'desc' },
            }),
            this.prisma.flashCardSet.count({ where }),
        ]);

        return {
            flashcardSets,
            total,
            page: dto.page || 1,
            limit: dto.limit || 10,
            totalPages: Math.ceil(total / (dto.limit || 10)),
        };
    }

    async updateFlashcardSet(
        id: string,
        user: User,
        dto: UpdateFlashcardSetDto
    ) {
        try {
            const updatedFlashcardSet = await this.prisma.flashCardSet.update({
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
                    ...(dto.tag && { tag: dto.tag }),
                    ...(dto.thumbnail && { thumbnail: dto.thumbnail }),
                },
            });

            return {
                message: 'Cập nhật bộ thẻ ghi nhớ thành công',
                flashcardSet: updatedFlashcardSet,
            };
        } catch (error) {
            if (error.code === 'P2025') {
                throw new NotFoundException('Bộ thẻ ghi nhớ không tồn tại');
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
                };
            });

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
     * - 1 historyId chứa nhiều flashcards (JSON array)
     * - Lấy tất cả flashcards từ history.flashcards
     * - Tạo FlashCard từ mỗi flashcard trong array
     * - Tạo DetailsFlashCard với historyGeneratedFlashcardId để track và prevent duplicate
     * - Constraint @@unique([flashCardSetId, historyGeneratedFlashcardId]) sẽ tự động ngăn lưu trùng
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
                const history = await tx.historyGeneratedFlashcard.findUnique({
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
                let createdCount = 0;
                let skippedCount = 0;

                // Kiểm tra history đã được lưu vào flashcardSet nào chưa
                const existingDetails = await tx.detailsFlashCard.findMany({
                    where: {
                        flashCardSetId: { in: flashcardSetIds },
                        historyGeneratedFlashcardId: dto.historyId,
                    },
                    select: {
                        flashCardSetId: true,
                    },
                });

                // Tạo Set các flashcardSetId đã có history này
                const existingFlashcardSetIds = new Set(
                    existingDetails.map((d) => d.flashCardSetId)
                );

                // Tạo FlashCard cho mỗi flashcard trong history
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

                    const flashcardId = this.generateIdService.generateId();

                    // Tạo FlashCard từ flashcard data
                    await tx.flashCard.create({
                        data: {
                            id: flashcardId,
                            question: flashcardData.question || '',
                            answer: flashcardData.answer || '',
                        },
                    });

                    // Tạo DetailsFlashCard cho mỗi flashcardSet chưa có history này
                    for (const flashcardSetId of flashcardSetIds) {
                        // Skip nếu flashcardSet này đã có history này rồi
                        if (existingFlashcardSetIds.has(flashcardSetId)) {
                            console.log(
                                `⚠️ History ${history.id} đã được lưu vào FlashcardSet ${flashcardSetId} trước đó`
                            );
                            skippedCount++;
                            continue;
                        }

                        await tx.detailsFlashCard.create({
                            data: {
                                id: this.generateIdService.generateId(),
                                flashCardSetId: flashcardSetId,
                                flashCardId: flashcardId,
                                historyGeneratedFlashcardId: history.id,
                            },
                        });
                        createdCount++;
                    }

                    // Sau khi tạo xong flashcard này cho tất cả flashcardSets, mark tất cả là đã có
                    flashcardSetIds.forEach((id) =>
                        existingFlashcardSetIds.add(id)
                    );
                }

                return {
                    createdCount,
                    skippedCount,
                    totalFlashcards: flashcards.length,
                    affectedFlashcardSetsCount: flashcardSetIds.length,
                };
            });

            return {
                message: `Đã lưu ${result.totalFlashcards} thẻ ghi nhớ vào ${result.affectedFlashcardSetsCount} bộ thẻ ghi nhớ${result.skippedCount > 0 ? ` (${result.skippedCount} đã tồn tại)` : ''}`,
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
}
