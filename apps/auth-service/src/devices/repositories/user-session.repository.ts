import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UserSession } from '@prisma/client';

@Injectable()
export class UserSessionRepository {
    constructor(private readonly prisma: PrismaService) {}

    async create(data: {
        id: string;
        userId: string;
        sessionId: string;
        deviceId: string;
        deviceName?: string | null;
        browser?: string | null;
        os?: string | null;
        ipAddress?: string | null;
        country?: string | null;
        city?: string | null;
        expiresAt: Date;
    }): Promise<UserSession> {
        return this.prisma.userSession.create({ data });
    }

    async findBySessionId(sessionId: string): Promise<UserSession | null> {
        return this.prisma.userSession.findUnique({
            where: { sessionId },
        });
    }

    async findActiveSessionsByUserId(userId: string): Promise<UserSession[]> {
        return this.prisma.userSession.findMany({
            where: {
                userId,
                isActive: true,
            },
            orderBy: { lastActivity: 'desc' },
        });
    }

    async updateLastActivity(sessionId: string): Promise<void> {
        await this.prisma.userSession.update({
            where: { sessionId },
            data: { lastActivity: new Date() },
        });
    }

    async deactivateSession(id: string): Promise<void> {
        await this.prisma.userSession.update({
            where: { id },
            data: { isActive: false },
        });
    }

    async deactivateAllOtherSessions(
        userId: string,
        currentSessionId: string
    ): Promise<number> {
        const result = await this.prisma.userSession.updateMany({
            where: {
                userId,
                sessionId: { not: currentSessionId },
                isActive: true,
            },
            data: { isActive: false },
        });
        return result.count;
    }

    async findById(id: string): Promise<UserSession | null> {
        return this.prisma.userSession.findFirst({
            where: { id },
        });
    }

    // Cleanup methods for cron job
    async deleteExpiredSessions(): Promise<number> {
        const result = await this.prisma.userSession.deleteMany({
            where: {
                expiresAt: { lt: new Date() },
            },
        });
        return result.count;
    }

    async deactivateInactiveSessions(inactiveDays: number): Promise<number> {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - inactiveDays);

        const result = await this.prisma.userSession.updateMany({
            where: {
                lastActivity: { lt: cutoffDate },
                isActive: true,
            },
            data: { isActive: false },
        });
        return result.count;
    }

    async deleteOldSessions(retentionDays: number): Promise<number> {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

        const result = await this.prisma.userSession.deleteMany({
            where: {
                createdAt: { lt: cutoffDate },
            },
        });
        return result.count;
    }
}
