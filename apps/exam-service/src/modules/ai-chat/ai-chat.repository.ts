import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@examio/database';

@Injectable()
export class AIChatRepository {
    private readonly logger = new Logger(AIChatRepository.name);

    constructor(private readonly prisma: PrismaService) {}

    // ==================== CHAT ====================

    async findChatsByUserId(userId: string) {
        return this.prisma.aIChat.findMany({
            where: { userId },
            orderBy: { updatedAt: 'desc' },
            include: {
                messages: {
                    orderBy: { createdAt: 'desc' },
                    take: 1,
                    select: { content: true },
                },
                _count: { select: { messages: true } },
            },
        });
    }

    async findChatById(chatId: string) {
        return this.prisma.aIChat.findUnique({
            where: { id: chatId },
        });
    }

    async createChat(data: { id: string; userId: string; title?: string }) {
        return this.prisma.aIChat.create({
            data: {
                id: data.id,
                userId: data.userId,
                title: data.title || '',
            },
        });
    }

    async updateChat(chatId: string, data: { title?: string }) {
        return this.prisma.aIChat.update({
            where: { id: chatId },
            data: {
                title: data.title,
                updatedAt: new Date(),
            },
        });
    }

    async deleteChat(chatId: string) {
        return this.prisma.aIChat.delete({
            where: { id: chatId },
        });
    }

    async chatExists(chatId: string) {
        const count = await this.prisma.aIChat.count({
            where: { id: chatId },
        });
        return count > 0;
    }

    // ==================== MESSAGES ====================

    async findMessagesByChatId(chatId: string) {
        return this.prisma.aIChatMessage.findMany({
            where: { chatId },
            orderBy: { createdAt: 'asc' },
        });
    }

    async findMessageById(messageId: string) {
        return this.prisma.aIChatMessage.findUnique({
            where: { id: messageId },
        });
    }

    async createMessage(data: {
        id: string;
        chatId: string;
        role: string;
        content: string;
        imageUrl?: string;
        documentId?: string;
        documentName?: string;
    }) {
        const message = await this.prisma.aIChatMessage.create({
            data: {
                id: data.id,
                chatId: data.chatId,
                role: data.role,
                content: data.content,
                imageUrl: data.imageUrl,
                documentId: data.documentId,
                documentName: data.documentName,
            },
        });

        // Update chat updatedAt
        await this.prisma.aIChat.update({
            where: { id: data.chatId },
            data: { updatedAt: new Date() },
        });

        return message;
    }

    async updateMessage(messageId: string, data: { content: string }) {
        return this.prisma.aIChatMessage.update({
            where: { id: messageId },
            data: { content: data.content },
        });
    }

    async deleteMessage(messageId: string) {
        return this.prisma.aIChatMessage.delete({
            where: { id: messageId },
        });
    }

    async deleteMessagesAfter(chatId: string, afterDate: Date) {
        return this.prisma.aIChatMessage.deleteMany({
            where: {
                chatId,
                createdAt: { gte: afterDate },
            },
        });
    }

    // ==================== DOCUMENTS ====================

    async findDocumentsByChatId(chatId: string) {
        return this.prisma.aIChatDocument.findMany({
            where: { chatId },
            select: {
                documentId: true,
                documentName: true,
            },
        });
    }

    async addDocument(data: {
        chatId: string;
        documentId: string;
        documentName: string;
    }) {
        return this.prisma.aIChatDocument.create({
            data: {
                chatId: data.chatId,
                documentId: data.documentId,
                documentName: data.documentName,
            },
        });
    }

    async removeDocument(chatId: string, documentId: string) {
        return this.prisma.aIChatDocument.deleteMany({
            where: { chatId, documentId },
        });
    }

    async getDocumentIds(chatId: string): Promise<string[]> {
        const docs = await this.prisma.aIChatDocument.findMany({
            where: { chatId },
            select: { documentId: true },
        });
        return docs.map((d) => d.documentId);
    }
}
