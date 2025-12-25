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
import { AIService } from '../ai/ai.service';
import { SubscriptionService } from '../finance/modules/sepay/subscription.service';
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

// Chat limits
const MAX_HISTORY_MESSAGES = 30; // Sliding window size for AI context
const MAX_USER_MESSAGES_PER_CHAT = 50; // Max user messages per chat (100 total)
const HISTORY_CACHE_TTL = 60; // Cache history for 60 seconds

@Injectable()
export class AIChatService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly redisService: RedisService,
        private readonly virtualTeacherService: VirtualTeacherService,
        private readonly generateIdService: GenerateIdService,
        private readonly r2Service: R2Service,
        private readonly aiService: AIService,
        private readonly subscriptionService: SubscriptionService
    ) {}

    /**
     * Get chat history for AI context (sliding window, cached)
     * O(1) with cache hit, else O(n) where n = message count
     * @returns Array of { role: 'user' | 'model', content: string }
     */
    private async getChatHistoryForAI(
        chatId: string,
        userId: string
    ): Promise<Array<{ role: 'user' | 'model'; content: string }>> {
        const cacheKey = getItemCacheKey(
            AI_CHAT_MODULE,
            userId,
            chatId,
            'ai_history'
        );

        // Try cache first (O(1))
        const cached =
            await this.redisService.get<
                Array<{ role: 'user' | 'model'; content: string }>
            >(cacheKey);
        if (cached) {
            return cached;
        }

        // Fetch last 30 messages from DB
        const messages = await this.prisma.aIChatMessage.findMany({
            where: { chatId },
            orderBy: { createdAt: 'desc' },
            take: MAX_HISTORY_MESSAGES,
            select: { role: true, content: true },
        });

        // Reverse to get chronological order and map to AI format
        const history = messages.reverse().map((msg) => ({
            role: (msg.role === 'assistant' ? 'model' : 'user') as
                | 'user'
                | 'model',
            content: msg.content,
        }));

        // Cache for next requests
        await this.redisService.set(cacheKey, history, HISTORY_CACHE_TTL);

        return history;
    }

    /**
     * Get user message count (cached for O(1))
     */
    private async getUserMessageCount(chatId: string): Promise<number> {
        const cacheKey = `ai_chat:msg_count:${chatId}`;

        const cached = await this.redisService.get<number>(cacheKey);
        if (cached !== null) {
            return cached;
        }

        const count = await this.prisma.aIChatMessage.count({
            where: { chatId, role: 'user' },
        });

        // Cache indefinitely (invalidated on message create/delete)
        await this.redisService.set(cacheKey, count, EXPIRED_TIME.ONE_DAY);
        return count;
    }

    /**
     * Increment user message count cache
     */
    private async incrementMessageCount(chatId: string): Promise<void> {
        const cacheKey = `ai_chat:msg_count:${chatId}`;
        const current = await this.getUserMessageCount(chatId);
        await this.redisService.set(
            cacheKey,
            current + 1,
            EXPIRED_TIME.ONE_DAY
        );
    }

    /**
     * Check if chat has reached message limit based on subscription tier
     */
    private async checkMessageLimit(
        chatId: string,
        userId: string
    ): Promise<void> {
        const benefits =
            await this.subscriptionService.getUserSubscriptionBenefits(userId);
        const limit = benefits.chatMessagesLimit;

        const count = await this.getUserMessageCount(chatId);
        if (count >= limit) {
            throw new BadRequestException(
                `Đoạn chat này đã đạt giới hạn ${limit} tin nhắn. Vui lòng tạo đoạn chat mới hoặc nâng cấp gói.`
            );
        }
    }

    /**
     * Invalidate history cache when messages change
     */
    private async invalidateHistoryCache(
        userId: string,
        chatId: string
    ): Promise<void> {
        const historyKey = getItemCacheKey(
            AI_CHAT_MODULE,
            userId,
            chatId,
            'ai_history'
        );
        const countKey = `ai_chat:msg_count:${chatId}`;
        await Promise.all([
            this.redisService.del(historyKey),
            this.redisService.del(countKey),
        ]);
    }

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

    /**
     * Add a document to chat (multi-doc support)
     * O(1) insert with unique constraint handling
     */
    async addDocument(
        chatId: string,
        userId: string,
        documentId: string,
        documentName: string
    ): Promise<{ id: string; documentId: string; documentName: string }> {
        const chat = await this.prisma.aIChat.findFirst({
            where: { id: chatId, userId },
        });

        if (!chat) {
            throw new NotFoundException('Chat không tồn tại');
        }

        // Upsert to handle duplicates gracefully
        const doc = await this.prisma.aIChatDocument.upsert({
            where: {
                chatId_documentId: { chatId, documentId },
            },
            create: {
                chatId,
                documentId,
                documentName,
            },
            update: {
                documentName, // Update name if changed
            },
        });

        console.log(
            `[AIChatService] Added document ${documentName} to chat ${chatId}`
        );

        return {
            id: doc.id,
            documentId: doc.documentId,
            documentName: doc.documentName,
        };
    }

    /**
     * Remove a document from chat
     */
    async removeDocument(
        chatId: string,
        userId: string,
        documentId: string
    ): Promise<void> {
        const chat = await this.prisma.aIChat.findFirst({
            where: { id: chatId, userId },
        });

        if (!chat) {
            throw new NotFoundException('Chat không tồn tại');
        }

        await this.prisma.aIChatDocument.deleteMany({
            where: { chatId, documentId },
        });

        console.log(
            `[AIChatService] Removed document ${documentId} from chat ${chatId}`
        );
    }

    /**
     * Clear all documents from chat
     */
    async clearDocuments(chatId: string, userId: string): Promise<void> {
        const chat = await this.prisma.aIChat.findFirst({
            where: { id: chatId, userId },
        });

        if (!chat) {
            throw new NotFoundException('Chat không tồn tại');
        }

        await this.prisma.aIChatDocument.deleteMany({
            where: { chatId },
        });

        console.log(
            `[AIChatService] Cleared all documents from chat ${chatId}`
        );
    }

    /**
     * Get all documents for a chat
     * O(1) lookup via chatId index
     */
    async getChatDocuments(
        chatId: string,
        userId: string
    ): Promise<Array<{ documentId: string; documentName: string }>> {
        const chat = await this.prisma.aIChat.findFirst({
            where: { id: chatId, userId },
        });

        if (!chat) {
            throw new NotFoundException('Chat không tồn tại');
        }

        const docs = await this.prisma.aIChatDocument.findMany({
            where: { chatId },
            select: { documentId: true, documentName: true },
            orderBy: { createdAt: 'asc' },
        });

        return docs;
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
        const benefits =
            await this.subscriptionService.getUserSubscriptionBenefits(userId);
        const limit = benefits.messagesPerMinute;

        // -1 means unlimited (VIP)
        if (limit === -1) return;

        const key = this.getRateLimitKey(userId);
        const count = await this.redisService.get<number>(key);

        if (count !== null && count >= limit) {
            throw new BadRequestException(
                `Bạn chỉ được gửi tối đa ${limit} tin nhắn mỗi phút. Vui lòng chờ một chút.`
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

        // Check rate limit and message limit
        await this.checkRateLimit(userId);
        await this.checkMessageLimit(chatId, userId);

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

        // Increment message count cache
        await this.incrementMessageCount(chatId);

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
            // Get chat history for context (cached, sliding window)
            const history = await this.getChatHistoryForAI(chatId, userId);

            // Get all documents linked to this chat (O(1) via index)
            const chatDocs = await this.getChatDocuments(chatId, userId);
            const chatDocumentIds = chatDocs.map((d) => d.documentId);

            if (dto.imageUrl) {
                // Image chat doesn't use history (model limitation)
                for await (const chunk of this.virtualTeacherService.processImageChatStream(
                    dto.imageUrl,
                    dto.message,
                    userId
                )) {
                    fullResponse += chunk;
                    yield chunk;
                }
            } else {
                // Smart RAG: Check if we should apply RAG based on intent
                let effectiveDocumentIds: string[] = [];

                // Collect all source IDs: from DTO + from chat's linked documents
                if (dto.documentIds && Array.isArray(dto.documentIds)) {
                    effectiveDocumentIds.push(...dto.documentIds);
                }
                if (dto.documentId) {
                    effectiveDocumentIds.push(dto.documentId);
                }
                // Add documents from chat's AIChatDocument table
                effectiveDocumentIds.push(...chatDocumentIds);

                // Deduplicate
                effectiveDocumentIds = [...new Set(effectiveDocumentIds)];

                if (effectiveDocumentIds.length > 0) {
                    // Process any documents that haven't been OCR'd yet (on-demand processing)
                    await this.aiService.checkAndProcessDocuments(
                        effectiveDocumentIds
                    );

                    // Chat has documents - use intent detection
                    const intent =
                        await this.virtualTeacherService.detectIntent(
                            dto.message,
                            history
                        );

                    if (intent === 'RAG') {
                        console.log(
                            `[Smart RAG] Applying RAG for message: "${dto.message.substring(0, 50)}..." with ${effectiveDocumentIds.length} docs`
                        );
                    } else {
                        console.log(
                            `[Smart RAG] Skipping RAG (GENERAL intent) for message: "${dto.message.substring(0, 50)}..."`
                        );
                        // If general intent, we might still pass IDs but maybe the service handles it?
                        // The original code passed effectiveDocumentId only if RAG.
                        // But wait, passing ID implies FORCE RAG in the service?
                        // Service uses getDocumentContextSemantic if ID is present.
                        // So if intent is GENERAL, we should probably NOT pass IDs?
                        // Original code: if intent === 'RAG' { effectiveDocumentId = activeDocumentId; }
                        // So if GENERAL, effectiveDocumentId remained null (unless dto provided it? NO, original code used local var)

                        // Let's match original logic: Only use IDs if RAG intent is detected OR if explicitly asked?
                        // Usually if user attaches a file explicitly in this message, they want RAG.
                        // But here IDs might come from "active" state.

                        // Let's assume if RAG, we pass ALL IDs. If not, we pass empty.
                        // UNLESS logic says "Always RAG if explicit"?
                        // Let's stick to "If General, clear IDs".
                        effectiveDocumentIds = [];
                    }
                }

                // Use history-aware chat streaming with optional semantic search
                // Note: passing null for single ID legacy param, and array for new param
                for await (const chunk of this.virtualTeacherService.processChatWithHistoryStream(
                    dto.message,
                    history,
                    null, // Legacy single ID
                    effectiveDocumentIds, // New array IDs
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

            // Invalidate all caches
            await this.invalidateUserChatsCache(userId);
            await this.invalidateChatMessagesCache(userId, chatId);
            await this.invalidateHistoryCache(userId, chatId);

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
