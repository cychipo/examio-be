import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@examio/database';
import { UserStorage, Prisma } from '@prisma/client';

@Injectable()
export class AIRepository {
    private readonly logger = new Logger(AIRepository.name);

    constructor(private readonly prisma: PrismaService) {}

    async createUserStorage(data: {
        id: string;
        userId: string;
        filename: string;
        url: string;
        mimetype: string;
        size: number;
        keyR2: string;
        processingStatus?: string;
        creditCharged?: boolean;
    }): Promise<UserStorage> {
        // Use upsert to handle case where keyR2 already exists (e.g., from failed upload)
        return this.prisma.userStorage.upsert({
            where: { keyR2: data.keyR2 },
            create: {
                id: data.id,
                userId: data.userId,
                filename: data.filename,
                url: data.url,
                mimetype: data.mimetype,
                size: data.size,
                keyR2: data.keyR2,
                processingStatus: data.processingStatus || 'PENDING',
                creditCharged: data.creditCharged ?? false,
            },
            update: {
                // Reset status for retry
                processingStatus: data.processingStatus || 'PENDING',
                creditCharged: data.creditCharged ?? false,
                updatedAt: new Date(),
            },
        });
    }

    async findUserStorageById(id: string): Promise<UserStorage | null> {
        return this.prisma.userStorage.findUnique({
            where: { id },
        });
    }

    async findUserStoragesByUserId(
        userId: string,
        options?: { page?: number; size?: number }
    ) {
        const page = options?.page || 1;
        const size = options?.size || 10;
        const skip = (page - 1) * size;

        const [data, total] = await Promise.all([
            this.prisma.userStorage.findMany({
                where: { userId },
                orderBy: { createdAt: 'desc' },
                skip,
                take: size,
                include: {
                    // Include latest quiz history - only metadata, not full quizzes
                    historyGeneratedQuizz: {
                        orderBy: { createdAt: 'desc' },
                        take: 1,
                        select: {
                            id: true,
                            createdAt: true,
                        },
                    },
                    // Include latest flashcard history - only metadata, not full flashcards
                    historyGeneratedFlashcard: {
                        orderBy: { createdAt: 'desc' },
                        take: 1,
                        select: {
                            id: true,
                            createdAt: true,
                        },
                    },
                },
            }),
            this.prisma.userStorage.count({
                where: { userId },
            }),
        ]);

        // Transform data to match FE expected format - only include IDs, not full data
        const transformedData = data.map((item) => {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const {
                historyGeneratedQuizz,
                historyGeneratedFlashcard,
                ...rest
            } = item;
            return {
                ...rest,
                // FE expects quizHistory (singular) with latest quiz metadata
                quizHistory: historyGeneratedQuizz?.[0]
                    ? {
                          id: historyGeneratedQuizz[0].id,
                          createdAt: historyGeneratedQuizz[0].createdAt,
                      }
                    : null,
                // FE expects flashcardHistory (singular) with latest flashcard metadata
                flashcardHistory: historyGeneratedFlashcard?.[0]
                    ? {
                          id: historyGeneratedFlashcard[0].id,
                          createdAt: historyGeneratedFlashcard[0].createdAt,
                      }
                    : null,
            };
        });

        return { data: transformedData, total };
    }

    async updateUserStorageStatus(
        id: string,
        status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'
    ): Promise<UserStorage> {
        return this.prisma.userStorage.update({
            where: { id },
            data: { processingStatus: status },
        });
    }

    async deleteUserStorage(id: string): Promise<UserStorage> {
        return this.prisma.userStorage.delete({
            where: { id },
        });
    }

    async deleteDocumentsByUserStorageId(
        userStorageId: string
    ): Promise<{ count: number }> {
        return this.prisma.document.deleteMany({
            where: { userStorageId },
        });
    }

    async markCreditCharged(id: string): Promise<UserStorage> {
        return this.prisma.userStorage.update({
            where: { id },
            data: { creditCharged: true },
        });
    }

    /**
     * Find the latest quiz history for a userStorage
     */
    async findLatestQuizHistory(userStorageId: string) {
        return this.prisma.historyGeneratedQuizz.findFirst({
            where: { userStorageId },
            orderBy: { createdAt: 'desc' },
        });
    }

    /**
     * Find the latest flashcard history for a userStorage
     */
    async findLatestFlashcardHistory(userStorageId: string) {
        return this.prisma.historyGeneratedFlashcard.findFirst({
            where: { userStorageId },
            orderBy: { createdAt: 'desc' },
        });
    }
}
