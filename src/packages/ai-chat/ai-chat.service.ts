import {
    Injectable,
    NotFoundException,
    BadRequestException,
    ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { VirtualTeacherService } from '../virtual-teacher/virtual-teacher.service';
import { GenerateIdService } from 'src/common/services/generate-id.service';
import { R2Service } from '../r2/r2.service';
import {
    CreateChatDto,
    SendMessageDto,
    UpdateChatDto,
    UpdateMessageDto,
    ChatResponseDto,
    ChatListResponseDto,
    MessageResponseDto,
    SendMessageResponseDto,
} from './dto/ai-chat.dto';
import {
    getUserCacheKey,
    getItemCacheKey,
} from 'src/common/constants/cache-keys';
import { EXPIRED_TIME } from 'src/constants/redis';

// Cache module key for AI Chat
const AI_CHAT_MODULE = 'AI_CHAT' as const;

@Injectable()
export class AIChatService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly redisService: RedisService,
        private readonly virtualTeacherService: VirtualTeacherService,
        private readonly generateIdService: GenerateIdService,
        private readonly r2Service: R2Service
    ) {}

    async getChats(userId: string): Promise<ChatListResponseDto> {
        const cacheKey = getUserCacheKey(AI_CHAT_MODULE, userId);
        const cached =
            await this.redisService.get<ChatListResponseDto>(cacheKey);
        if (cached) {
            console.log(`[AIChatService] Cache hit for chats list: ${userId}`);
            return cached;
        }

        const chats = await this.prisma.aIChat.findMany({
            where: { userId },
            orderBy: { updatedAt: 'desc' },
            include: {
                messages: {
                    orderBy: { createdAt: 'desc' },
                    take: 1,
                    select: {
                        content: true,
                    },
                },
                _count: {
                    select: { messages: true },
                },
            },
        });

        const result: ChatListResponseDto = {
            chats: chats.map((chat) => ({
                id: chat.id,
                userId: chat.userId,
                title: chat.title,
                createdAt: chat.createdAt,
                updatedAt: chat.updatedAt,
                lastMessage: chat.messages[0]?.content?.substring(0, 100),
                messageCount: chat._count.messages,
            })),
            total: chats.length,
        };

        await this.redisService.set(cacheKey, result, EXPIRED_TIME.ONE_HOUR);
        return result;
    }

    async getChatMessages(
        chatId: string,
        userId: string
    ): Promise<MessageResponseDto[]> {
        const chat = await this.prisma.aIChat.findFirst({
            where: { id: chatId, userId },
        });
        if (!chat) {
            throw new NotFoundException('Chat không tồn tại');
        }

        const cacheKey = getItemCacheKey(
            AI_CHAT_MODULE,
            userId,
            chatId,
            'messages'
        );
        const cached =
            await this.redisService.get<MessageResponseDto[]>(cacheKey);
        if (cached) {
            console.log(
                `[AIChatService] Cache hit for chat messages: ${chatId}`
            );
            return cached;
        }

        const messages = await this.prisma.aIChatMessage.findMany({
            where: { chatId },
            orderBy: { createdAt: 'asc' },
        });

        const result: MessageResponseDto[] = messages.map((msg) => ({
            id: msg.id,
            chatId: msg.chatId,
            role: msg.role,
            content: msg.content,
            imageUrl: msg.imageUrl || undefined,
            documentId: msg.documentId || undefined,
            documentName: msg.documentName || undefined,
            createdAt: msg.createdAt,
        }));

        await this.redisService.set(cacheKey, result, EXPIRED_TIME.ONE_HOUR);
        return result;
    }

    async chatExists(chatId: string, userId: string): Promise<boolean> {
        const chat = await this.prisma.aIChat.findFirst({
            where: { id: chatId, userId },
        });
        return !!chat;
    }

    async createChat(
        userId: string,
        dto: CreateChatDto
    ): Promise<ChatResponseDto> {
        const existingEmptyChat = await this.prisma.aIChat.findFirst({
            where: {
                userId,
                title: '',
            },
            include: {
                _count: { select: { messages: true } },
            },
            orderBy: { createdAt: 'desc' },
        });

        if (existingEmptyChat && existingEmptyChat._count.messages === 0) {
            return {
                id: existingEmptyChat.id,
                userId: existingEmptyChat.userId,
                title: existingEmptyChat.title,
                createdAt: existingEmptyChat.createdAt,
                updatedAt: existingEmptyChat.updatedAt,
                messages: [],
                messageCount: 0,
            };
        }

        const chat = await this.prisma.aIChat.create({
            data: {
                id: this.generateIdService.generateId(),
                userId,
                title: dto.title || '',
            },
        });

        await this.invalidateUserChatsCache(userId);

        return {
            id: chat.id,
            userId: chat.userId,
            title: chat.title,
            createdAt: chat.createdAt,
            updatedAt: chat.updatedAt,
            messages: [],
            messageCount: 0,
        };
    }

    async sendMessage(
        chatId: string,
        userId: string,
        dto: SendMessageDto
    ): Promise<SendMessageResponseDto> {
        const chat = await this.prisma.aIChat.findFirst({
            where: { id: chatId, userId },
        });
        if (!chat) {
            throw new NotFoundException('Chat không tồn tại');
        }

        const userMessage = await this.prisma.aIChatMessage.create({
            data: {
                id: this.generateIdService.generateId(),
                chatId,
                role: 'user',
                content: dto.message,
                imageUrl: dto.imageUrl,
                documentId: dto.documentId,
                documentName: dto.documentName,
            },
        });

        let aiResponse: { success: boolean; response: string; error?: string };

        if (dto.imageUrl) {
            aiResponse = await this.virtualTeacherService.processImageChat(
                dto.imageUrl,
                dto.message,
                userId
            );
        } else {
            aiResponse = await this.virtualTeacherService.processChat(
                { message: dto.message, documentId: dto.documentId },
                userId
            );
        }

        if (!aiResponse.success) {
            return {
                success: false,
                userMessage: this.mapToMessageDto(userMessage),
                error: aiResponse.error,
            };
        }

        const assistantMessage = await this.prisma.aIChatMessage.create({
            data: {
                id: this.generateIdService.generateId(),
                chatId,
                role: 'assistant',
                content: aiResponse.response,
            },
        });

        let chatTitle = chat.title;
        if (!chat.title) {
            chatTitle = this.generateChatTitle(aiResponse.response);
            await this.prisma.aIChat.update({
                where: { id: chatId },
                data: { title: chatTitle },
            });
        }

        await this.prisma.aIChat.update({
            where: { id: chatId },
            data: { updatedAt: new Date() },
        });

        await this.invalidateUserChatsCache(userId);
        await this.invalidateChatMessagesCache(userId, chatId);

        return {
            success: true,
            userMessage: this.mapToMessageDto(userMessage),
            assistantMessage: this.mapToMessageDto(assistantMessage),
            chatTitle,
        };
    }

    async regenerateFromMessage(
        messageId: string,
        userId: string
    ): Promise<SendMessageResponseDto> {
        const message = await this.prisma.aIChatMessage.findFirst({
            where: { id: messageId },
            include: { chat: true },
        });

        if (!message) {
            throw new NotFoundException('Tin nhắn không tồn tại');
        }

        if (message.chat.userId !== userId) {
            throw new ForbiddenException('Không có quyền truy cập');
        }

        if (message.role !== 'user') {
            throw new BadRequestException(
                'Chỉ có thể regenerate từ tin nhắn của bạn'
            );
        }

        await this.prisma.aIChatMessage.deleteMany({
            where: {
                chatId: message.chatId,
                createdAt: { gt: message.createdAt },
            },
        });

        let aiResponse: { success: boolean; response: string; error?: string };

        if (message.imageUrl) {
            aiResponse = await this.virtualTeacherService.processImageChat(
                message.imageUrl,
                message.content,
                userId
            );
        } else {
            aiResponse = await this.virtualTeacherService.processChat(
                {
                    message: message.content,
                    documentId: message.documentId || undefined,
                },
                userId
            );
        }

        if (!aiResponse.success) {
            await this.invalidateChatMessagesCache(userId, message.chatId);
            return {
                success: false,
                error: aiResponse.error,
            };
        }

        const assistantMessage = await this.prisma.aIChatMessage.create({
            data: {
                id: this.generateIdService.generateId(),
                chatId: message.chatId,
                role: 'assistant',
                content: aiResponse.response,
            },
        });

        await this.invalidateUserChatsCache(userId);
        await this.invalidateChatMessagesCache(userId, message.chatId);

        return {
            success: true,
            assistantMessage: this.mapToMessageDto(assistantMessage),
        };
    }

    async updateChat(
        chatId: string,
        userId: string,
        dto: UpdateChatDto
    ): Promise<ChatResponseDto> {
        const chat = await this.prisma.aIChat.findFirst({
            where: { id: chatId, userId },
        });
        if (!chat) {
            throw new NotFoundException('Chat không tồn tại');
        }

        const updated = await this.prisma.aIChat.update({
            where: { id: chatId },
            data: { title: dto.title },
        });

        await this.invalidateUserChatsCache(userId);

        return {
            id: updated.id,
            userId: updated.userId,
            title: updated.title,
            createdAt: updated.createdAt,
            updatedAt: updated.updatedAt,
        };
    }

    async deleteChat(chatId: string, userId: string): Promise<void> {
        const chat = await this.prisma.aIChat.findFirst({
            where: { id: chatId, userId },
        });
        if (!chat) {
            throw new NotFoundException('Chat không tồn tại');
        }

        const messagesWithImages = await this.prisma.aIChatMessage.findMany({
            where: {
                chatId,
                imageUrl: { not: null },
            },
            select: { imageUrl: true },
        });

        for (const msg of messagesWithImages) {
            if (msg.imageUrl) {
                const key = this.extractR2Key(msg.imageUrl);
                if (key) {
                    this.r2Service.deleteFile(key).catch((err) => {
                        console.error(
                            '[AIChatService] Failed to delete R2 image:',
                            key,
                            err
                        );
                    });
                }
            }
        }

        await this.prisma.aIChat.delete({
            where: { id: chatId },
        });

        await this.invalidateUserChatsCache(userId);
        await this.invalidateChatMessagesCache(userId, chatId);
    }

    async updateMessage(
        messageId: string,
        userId: string,
        dto: UpdateMessageDto
    ): Promise<MessageResponseDto> {
        const message = await this.prisma.aIChatMessage.findFirst({
            where: { id: messageId },
            include: { chat: true },
        });

        if (!message) {
            throw new NotFoundException('Tin nhắn không tồn tại');
        }

        if (message.chat.userId !== userId) {
            throw new ForbiddenException(
                'Không có quyền chỉnh sửa tin nhắn này'
            );
        }

        if (message.role !== 'user') {
            throw new BadRequestException(
                'Chỉ có thể chỉnh sửa tin nhắn của bạn'
            );
        }

        const updated = await this.prisma.aIChatMessage.update({
            where: { id: messageId },
            data: { content: dto.content },
        });

        await this.invalidateChatMessagesCache(userId, message.chatId);

        return this.mapToMessageDto(updated);
    }

    async deleteMessage(messageId: string, userId: string): Promise<void> {
        const message = await this.prisma.aIChatMessage.findFirst({
            where: { id: messageId },
            include: { chat: true },
        });

        if (!message) {
            throw new NotFoundException('Tin nhắn không tồn tại');
        }

        if (message.chat.userId !== userId) {
            throw new ForbiddenException('Không có quyền xóa tin nhắn này');
        }

        if (message.imageUrl) {
            const key = this.extractR2Key(message.imageUrl);
            if (key) {
                this.r2Service.deleteFile(key).catch((err) => {
                    console.error(
                        '[AIChatService] Failed to delete R2 image:',
                        key,
                        err
                    );
                });
            }
        }

        await this.prisma.aIChatMessage.delete({
            where: { id: messageId },
        });

        await this.invalidateChatMessagesCache(userId, message.chatId);
    }

    private mapToMessageDto(message: any): MessageResponseDto {
        return {
            id: message.id,
            chatId: message.chatId,
            role: message.role,
            content: message.content,
            imageUrl: message.imageUrl || undefined,
            documentId: message.documentId || undefined,
            documentName: message.documentName || undefined,
            createdAt: message.createdAt,
        };
    }

    private generateChatTitle(response: string): string {
        const words = response.split(/\s+/).slice(0, 10).join(' ');
        if (words.length <= 50) {
            return words;
        }
        return words.substring(0, 47) + '...';
    }

    private extractR2Key(imageUrl: string): string | null {
        try {
            const url = new URL(imageUrl);
            return url.pathname.substring(1);
        } catch {
            return null;
        }
    }

    private async invalidateUserChatsCache(userId: string): Promise<void> {
        const cacheKey = getUserCacheKey(AI_CHAT_MODULE, userId);
        await this.redisService.del(cacheKey);
        console.log(
            `[AIChatService] Invalidated chats cache for user: ${userId}`
        );
    }

    private async invalidateChatMessagesCache(
        userId: string,
        chatId: string
    ): Promise<void> {
        const cacheKey = getItemCacheKey(
            AI_CHAT_MODULE,
            userId,
            chatId,
            'messages'
        );
        await this.redisService.del(cacheKey);
        console.log(
            `[AIChatService] Invalidated messages cache for chat: ${chatId}`
        );
    }

    private getRateLimitKey(userId: string): string {
        return `rate_limit:ai_chat:${userId}`;
    }

    async checkRateLimit(userId: string): Promise<void> {
        const key = this.getRateLimitKey(userId);
        const count = await this.redisService.get<number>(key);

        if (count !== null && count >= 5) {
            throw new BadRequestException(
                'Bạn chỉ được gửi tối đa 5 tin nhắn mỗi phút. Vui lòng chờ một chút.'
            );
        }

        if (count === null) {
            await this.redisService.set(key, 1, 60);
        } else {
            await this.redisService.set(key, count + 1, 60);
        }
    }

    async createUserMessageForStream(
        chatId: string,
        userId: string,
        dto: SendMessageDto
    ): Promise<{
        userMessage: MessageResponseDto;
        chatTitle: string;
        isNewChat: boolean;
    }> {
        const chat = await this.prisma.aIChat.findFirst({
            where: { id: chatId, userId },
        });
        if (!chat) {
            throw new NotFoundException('Chat không tồn tại');
        }

        await this.checkRateLimit(userId);

        const userMessage = await this.prisma.aIChatMessage.create({
            data: {
                id: this.generateIdService.generateId(),
                chatId,
                role: 'user',
                content: dto.message,
                imageUrl: dto.imageUrl,
                documentId: dto.documentId,
                documentName: dto.documentName,
            },
        });

        return {
            userMessage: this.mapToMessageDto(userMessage),
            chatTitle: chat.title,
            isNewChat: !chat.title,
        };
    }

    async *streamMessage(
        chatId: string,
        userId: string,
        dto: SendMessageDto
    ): AsyncGenerator<string | MessageResponseDto, void, unknown> {
        let fullResponse = '';

        try {
            if (dto.imageUrl) {
                for await (const chunk of this.virtualTeacherService.processImageChatStream(
                    dto.imageUrl,
                    dto.message,
                    userId
                )) {
                    fullResponse += chunk;
                    yield chunk;
                }
            } else {
                for await (const chunk of this.virtualTeacherService.processChatStream(
                    { message: dto.message, documentId: dto.documentId },
                    userId
                )) {
                    fullResponse += chunk;
                    yield chunk;
                }
            }

            const assistantMessage = await this.prisma.aIChatMessage.create({
                data: {
                    id: this.generateIdService.generateId(),
                    chatId,
                    role: 'assistant',
                    content: fullResponse,
                },
            });

            const chat = await this.prisma.aIChat.findFirst({
                where: { id: chatId, userId },
            });

            if (chat && !chat.title && fullResponse) {
                const newTitle = this.generateChatTitle(fullResponse);
                await this.prisma.aIChat.update({
                    where: { id: chatId },
                    data: { title: newTitle },
                });
            }

            await this.prisma.aIChat.update({
                where: { id: chatId },
                data: { updatedAt: new Date() },
            });

            await this.invalidateUserChatsCache(userId);
            await this.invalidateChatMessagesCache(userId, chatId);

            yield this.mapToMessageDto(assistantMessage);
        } catch (error) {
            console.error('[AIChatService] Stream error:', error);
        }
    }

    async deleteMessagesAfter(
        messageId: string,
        userId: string
    ): Promise<{ chatId: string; userMessage: MessageResponseDto }> {
        const message = await this.prisma.aIChatMessage.findFirst({
            where: { id: messageId },
            include: { chat: true },
        });

        if (!message) {
            throw new NotFoundException('Tin nhắn không tồn tại');
        }

        if (message.chat.userId !== userId) {
            throw new ForbiddenException('Không có quyền truy cập');
        }

        if (message.role !== 'user') {
            throw new BadRequestException(
                'Chỉ có thể regenerate từ tin nhắn của bạn'
            );
        }

        await this.checkRateLimit(userId);

        await this.prisma.aIChatMessage.deleteMany({
            where: {
                chatId: message.chatId,
                createdAt: { gt: message.createdAt },
            },
        });

        await this.invalidateChatMessagesCache(userId, message.chatId);

        return {
            chatId: message.chatId,
            userMessage: this.mapToMessageDto(message),
        };
    }
}
