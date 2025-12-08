import {
    Injectable,
    NotFoundException,
    BadRequestException,
    ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { VirtualTeacherService } from '../virtual-teacher/virtual-teacher.service';
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
    getUserCachePattern,
} from 'src/common/constants/cache-keys';
import { EXPIRED_TIME } from 'src/constants/redis';

// Cache module key for AI Chat
const AI_CHAT_MODULE = 'AI_CHAT' as const;

@Injectable()
export class AIChatService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly redisService: RedisService,
        private readonly virtualTeacherService: VirtualTeacherService
    ) {}

    /**
     * Get all chats for a user with caching
     */
    async getChats(userId: string): Promise<ChatListResponseDto> {
        // Check cache first
        const cacheKey = getUserCacheKey(AI_CHAT_MODULE, userId);
        const cached =
            await this.redisService.get<ChatListResponseDto>(cacheKey);
        if (cached) {
            console.log(`[AIChatService] Cache hit for chats list: ${userId}`);
            return cached;
        }

        // Fetch from DB
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

        // Cache result
        await this.redisService.set(cacheKey, result, EXPIRED_TIME.ONE_HOUR);
        return result;
    }

    /**
     * Get messages for a specific chat
     */
    async getChatMessages(
        chatId: string,
        userId: string
    ): Promise<MessageResponseDto[]> {
        // Verify ownership
        const chat = await this.prisma.aIChat.findFirst({
            where: { id: chatId, userId },
        });
        if (!chat) {
            throw new NotFoundException('Chat không tồn tại');
        }

        // Check cache
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

        // Fetch from DB
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

        // Cache result
        await this.redisService.set(cacheKey, result, EXPIRED_TIME.ONE_HOUR);
        return result;
    }

    /**
     * Create a new chat
     */
    async createChat(
        userId: string,
        dto: CreateChatDto
    ): Promise<ChatResponseDto> {
        const chat = await this.prisma.aIChat.create({
            data: {
                userId,
                title: dto.title || '',
            },
        });

        // Invalidate list cache
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

    /**
     * Send a message and get AI response
     */
    async sendMessage(
        chatId: string,
        userId: string,
        dto: SendMessageDto
    ): Promise<SendMessageResponseDto> {
        // Verify ownership
        const chat = await this.prisma.aIChat.findFirst({
            where: { id: chatId, userId },
        });
        if (!chat) {
            throw new NotFoundException('Chat không tồn tại');
        }

        // Create user message
        const userMessage = await this.prisma.aIChatMessage.create({
            data: {
                chatId,
                role: 'user',
                content: dto.message,
                imageUrl: dto.imageUrl,
                documentId: dto.documentId,
                documentName: dto.documentName,
            },
        });

        // Get AI response
        let aiResponse: { success: boolean; response: string; error?: string };

        if (dto.imageUrl) {
            // Process with image
            aiResponse = await this.virtualTeacherService.processImageChat(
                dto.imageUrl,
                dto.message,
                userId
            );
        } else {
            // Process text only (with optional document context)
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

        // Create assistant message
        const assistantMessage = await this.prisma.aIChatMessage.create({
            data: {
                chatId,
                role: 'assistant',
                content: aiResponse.response,
            },
        });

        // Auto-generate title if chat has no title
        let chatTitle = chat.title;
        if (!chat.title) {
            // Get first 10 words from AI response
            chatTitle = this.generateChatTitle(aiResponse.response);
            await this.prisma.aIChat.update({
                where: { id: chatId },
                data: { title: chatTitle },
            });
        }

        // Update chat's updatedAt
        await this.prisma.aIChat.update({
            where: { id: chatId },
            data: { updatedAt: new Date() },
        });

        // Invalidate caches
        await this.invalidateUserChatsCache(userId);
        await this.invalidateChatMessagesCache(userId, chatId);

        return {
            success: true,
            userMessage: this.mapToMessageDto(userMessage),
            assistantMessage: this.mapToMessageDto(assistantMessage),
            chatTitle,
        };
    }

    /**
     * Update chat title
     */
    async updateChat(
        chatId: string,
        userId: string,
        dto: UpdateChatDto
    ): Promise<ChatResponseDto> {
        // Verify ownership
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

        // Invalidate cache
        await this.invalidateUserChatsCache(userId);

        return {
            id: updated.id,
            userId: updated.userId,
            title: updated.title,
            createdAt: updated.createdAt,
            updatedAt: updated.updatedAt,
        };
    }

    /**
     * Delete a chat
     */
    async deleteChat(chatId: string, userId: string): Promise<void> {
        // Verify ownership
        const chat = await this.prisma.aIChat.findFirst({
            where: { id: chatId, userId },
        });
        if (!chat) {
            throw new NotFoundException('Chat không tồn tại');
        }

        await this.prisma.aIChat.delete({
            where: { id: chatId },
        });

        // Invalidate caches
        await this.invalidateUserChatsCache(userId);
        await this.invalidateChatMessagesCache(userId, chatId);
    }

    /**
     * Update a message
     */
    async updateMessage(
        messageId: string,
        userId: string,
        dto: UpdateMessageDto
    ): Promise<MessageResponseDto> {
        // Find message and verify ownership
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

        // Invalidate cache
        await this.invalidateChatMessagesCache(userId, message.chatId);

        return this.mapToMessageDto(updated);
    }

    /**
     * Delete a message
     */
    async deleteMessage(messageId: string, userId: string): Promise<void> {
        // Find message and verify ownership
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

        await this.prisma.aIChatMessage.delete({
            where: { id: messageId },
        });

        // Invalidate cache
        await this.invalidateChatMessagesCache(userId, message.chatId);
    }

    // ================== HELPER METHODS ==================

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
        // Take first 10 words or 50 characters
        const words = response.split(/\s+/).slice(0, 10).join(' ');
        if (words.length <= 50) {
            return words;
        }
        return words.substring(0, 47) + '...';
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
}
