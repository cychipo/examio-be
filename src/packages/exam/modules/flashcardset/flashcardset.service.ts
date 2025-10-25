import { PrismaService } from 'src/prisma/prisma.service';
import {
    Injectable,
    ConflictException,
    NotFoundException,
    InternalServerErrorException,
} from '@nestjs/common';
import { GenerateIdService } from 'src/common/services/generate-id.service';
import { User } from '@prisma/client';
import { CreateFlashcardsetDto } from './dto/create-flashcardset.dto';
import { GetFlashcardsetsDto } from './dto/get-flashcardset.dto';
import { UpdateFlashcardSetDto } from './dto/update-flashcardset.dto';
import { SetFlashcardToFlashcardsetDto } from './dto/set-flashcard-to-flashcardset-dto';

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
}
