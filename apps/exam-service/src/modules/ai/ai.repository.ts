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
    }): Promise<UserStorage> {
        return this.prisma.userStorage.create({
            data: {
                id: data.id,
                userId: data.userId,
                filename: data.filename,
                url: data.url,
                mimetype: data.mimetype,
                size: data.size,
                keyR2: data.keyR2,
                processingStatus: data.processingStatus || 'PENDING',
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
    ): Promise<{ data: UserStorage[]; total: number }> {
        const page = options?.page || 1;
        const size = options?.size || 10;
        const skip = (page - 1) * size;

        const [data, total] = await Promise.all([
            this.prisma.userStorage.findMany({
                where: { userId },
                orderBy: { createdAt: 'desc' },
                skip,
                take: size,
            }),
            this.prisma.userStorage.count({
                where: { userId },
            }),
        ]);

        return { data, total };
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

    async markCreditCharged(id: string): Promise<UserStorage> {
        return this.prisma.userStorage.update({
            where: { id },
            data: { creditCharged: true },
        });
    }
}
