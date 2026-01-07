import {
    Injectable,
    Logger,
    NotFoundException,
    Inject,
    OnModuleInit,
    ForbiddenException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom, Observable, Subject } from 'rxjs';
import { ClientGrpc } from '@nestjs/microservices';
import { AIChatRepository } from './ai-chat.repository';
import { R2UploadService } from '../r2/r2-upload.service';
import { User } from '@prisma/client';
import { PrismaService } from '@examio/database';

interface SubscriptionService {
    getUserBenefits(data: { userId: string }): Observable<{
        tier: number;
        tier_name: string;
        files_per_month: number;
        messages_per_minute: number;
        chat_messages_limit: number;
    }>;
}

@Injectable()
export class AIChatService implements OnModuleInit {
    private readonly logger = new Logger(AIChatService.name);
    private readonly aiServiceUrl =
        process.env.AI_SERVICE_URL || 'http://localhost:8000/api';
    private subscriptionService: SubscriptionService;

    constructor(
        private readonly chatRepository: AIChatRepository,
        private readonly httpService: HttpService,
        private readonly r2UploadService: R2UploadService,
        @Inject('FINANCE_PACKAGE') private client: ClientGrpc,
        private readonly prisma: PrismaService
    ) {}

    onModuleInit() {
        this.subscriptionService = this.client.getService<SubscriptionService>(
            'SubscriptionService'
        );
    }

    // ==================== CHAT ====================

    async getChats(user: User) {
        const chats = await this.chatRepository.findChatsByUserId(user.id);
        return {
            chats: chats.map((chat) => ({
                id: chat.id,
                userId: chat.userId,
                subjectId: chat.subjectId,
                title: chat.title,
                createdAt: chat.createdAt,
                updatedAt: chat.updatedAt,
                lastMessage: chat.messages[0]?.content || '',
                messageCount: chat._count.messages,
                subject: chat.subject
                    ? {
                          id: chat.subject.id,
                          name: chat.subject.name,
                          slug: chat.subject.slug,
                          icon: chat.subject.icon,
                          color: chat.subject.color,
                      }
                    : null,
            })),
            total: chats.length,
        };
    }

    async createChat(user: User, title?: string, subjectId?: string) {
        const id = this.generateId();
        const chat = await this.chatRepository.createChat({
            id,
            userId: user.id,
            title: title || '',
            subjectId: subjectId || null,
        });

        // Return with subject info if available
        if (subjectId) {
            const subject = await this.prisma.subject.findUnique({
                where: { id: subjectId },
                select: {
                    id: true,
                    name: true,
                    slug: true,
                    icon: true,
                    color: true,
                },
            });
            return { ...chat, subject };
        }
        return chat;
    }

    async updateChat(chatId: string, user: User, title: string) {
        const chat = await this.getChatByIdAndValidateOwner(chatId, user);
        return this.chatRepository.updateChat(chat.id, { title });
    }

    async deleteChat(chatId: string, user: User) {
        await this.getChatByIdAndValidateOwner(chatId, user);
        await this.chatRepository.deleteChat(chatId);
        return { success: true, message: 'Chat deleted' };
    }

    async chatExists(chatId: string) {
        const exists = await this.chatRepository.chatExists(chatId);
        return { exists };
    }

    // ==================== MESSAGES ====================

    async getMessages(chatId: string, user: User) {
        await this.getChatByIdAndValidateOwner(chatId, user);
        return this.chatRepository.findMessagesByChatId(chatId);
    }

    async sendMessage(
        chatId: string,
        user: User,
        data: {
            message: string;
            imageUrl?: string;
            documentId?: string;
            documentIds?: string[];
            documentName?: string;
        }
    ) {
        const chat = await this.getChatByIdAndValidateOwner(chatId, user);

        // Create user message
        const userMessage = await this.chatRepository.createMessage({
            id: this.generateId(),
            chatId: chat.id,
            role: 'user',
            content: data.message,
            imageUrl: data.imageUrl,
            documentId: data.documentId,
            documentName: data.documentName,
        });

        // Get history for context - sliding window of 30 recent messages
        const history = await this.chatRepository.findMessagesByChatId(chatId);
        const historyForAI = history.slice(-30).map((m) => ({
            role: m.role,
            content: m.content,
        }));

        // Collect all document IDs: from DTO + from chat's linked documents
        let effectiveDocumentIds: string[] = [];
        if (data.documentIds && Array.isArray(data.documentIds)) {
            effectiveDocumentIds.push(...data.documentIds);
        }
        if (data.documentId) {
            effectiveDocumentIds.push(data.documentId);
        }
        // Add documents from chat's AIChatDocument table
        const chatDocIds = await this.chatRepository.getDocumentIds(chatId);
        effectiveDocumentIds.push(...chatDocIds);
        // Deduplicate
        effectiveDocumentIds = [...new Set(effectiveDocumentIds)];

        // Process documents on-demand if they haven't been OCR'd yet
        if (effectiveDocumentIds.length > 0) {
            await this.checkAndProcessDocuments(effectiveDocumentIds);
        }

        const userStorageId =
            effectiveDocumentIds.length > 0 ? effectiveDocumentIds[0] : null;

        // Call AI service
        let aiResponse = '';
        try {
            const response = await firstValueFrom(
                this.httpService.post(`${this.aiServiceUrl}/chat/query`, {
                    query: data.message,
                    history: historyForAI,
                    user_storage_id: userStorageId,
                })
            );
            aiResponse = response.data.answer || 'No response';
        } catch (error) {
            this.logger.error(`Error calling AI service: ${error.message}`);
            aiResponse = 'Xin lỗi, có lỗi xảy ra khi xử lý câu hỏi của bạn.';
        }

        // Create assistant message
        const assistantMessage = await this.chatRepository.createMessage({
            id: this.generateId(),
            chatId: chat.id,
            role: 'assistant',
            content: aiResponse,
        });

        // Update chat title if first message
        let chatTitle = chat.title;
        if (!chat.title && history.length <= 1) {
            chatTitle = data.message.slice(0, 50);
            await this.chatRepository.updateChat(chatId, { title: chatTitle });
        }

        return {
            success: true,
            userMessage,
            assistantMessage,
            chatTitle,
        };
    }

    async streamMessage(
        chatId: string,
        user: User,
        data: {
            message: string;
            imageUrl?: string;
            documentId?: string;
            documentIds?: string[];
            documentName?: string;
            modelType?: string;
        }
    ): Promise<Observable<any>> {
        const chat = await this.getChatByIdAndValidateOwner(chatId, user);

        // Check subscription limits
        await this.checkLimits(user.id, chatId);

        // Get subject system prompt if chat has a subject
        let systemPrompt: string | null = null;
        if (chat.subjectId) {
            const subject = await this.prisma.subject.findUnique({
                where: { id: chat.subjectId },
                select: { systemPrompt: true },
            });
            if (subject) {
                systemPrompt = subject.systemPrompt;
            }
        }

        // Collect all document IDs: from DTO + from chat's linked documents
        let effectiveDocumentIds: string[] = [];
        if (data.documentIds && Array.isArray(data.documentIds)) {
            effectiveDocumentIds.push(...data.documentIds);
        }
        if (data.documentId) {
            effectiveDocumentIds.push(data.documentId);
        }
        // Add documents from chat's AIChatDocument table
        const chatDocIds = await this.chatRepository.getDocumentIds(chatId);
        effectiveDocumentIds.push(...chatDocIds);
        // Deduplicate
        effectiveDocumentIds = [...new Set(effectiveDocumentIds)];

        // Process documents on-demand if they haven't been OCR'd yet
        if (effectiveDocumentIds.length > 0) {
            this.logger.log(
                `[streamMessage] Processing ${effectiveDocumentIds.length} documents on-demand...`
            );
            await this.checkAndProcessDocuments(effectiveDocumentIds);
        }

        // 1. Save User Message
        const userMessage = await this.chatRepository.createMessage({
            id: this.generateId(),
            chatId: chat.id,
            role: 'user',
            content: data.message,
            imageUrl: data.imageUrl,
            documentId: data.documentId,
            documentName: data.documentName,
        });

        const subject = new Subject<any>();

        // 2. Prepare History & Payload
        const history = await this.chatRepository.findMessagesByChatId(chatId);
        const historyForAI = history.slice(-30).map((m) => ({
            role: m.role,
            content: m.content,
        }));

        const userStorageId =
            effectiveDocumentIds.length > 0 ? effectiveDocumentIds[0] : null;

        const payload = {
            query: data.message,
            history: historyForAI,
            user_storage_id: userStorageId,
            model_type: data.modelType || 'gemini',
            system_prompt: systemPrompt, // Subject-specific system prompt
        };

        this.logger.log(
            `[streamMessage] Using AI model: ${payload.model_type}`
        );

        // 3. Call AI Service Stream
        this.httpService
            .post(`${this.aiServiceUrl}/chat/stream`, payload, {
                responseType: 'stream',
            })
            .subscribe({
                next: (response) => {
                    // Emit user message first
                    subject.next({ type: 'user_message', data: userMessage });

                    const stream = response.data;
                    let buffer = '';
                    let accumulatedAnswer = '';

                    stream.on('data', (chunk: Buffer) => {
                        buffer += chunk.toString();
                        const lines = buffer.split('\n');
                        buffer = lines.pop() || '';

                        for (const line of lines) {
                            if (line.trim().startsWith('data: ')) {
                                try {
                                    const eventData = line.trim().slice(6);
                                    if (eventData === '[DONE]') continue;

                                    const event = JSON.parse(eventData);
                                    if (event.type === 'chunk') {
                                        accumulatedAnswer += event.data;
                                        subject.next({
                                            type: 'chunk',
                                            data: event.data,
                                        });
                                    } else if (event.type === 'error') {
                                        subject.next({
                                            type: 'error',
                                            data: event.data,
                                        });
                                    }
                                } catch (e) {
                                    // Ignore parse error
                                }
                            }
                        }
                    });

                    stream.on('end', async () => {
                        try {
                            // 4. Save Assistant Message
                            const assistantMessage =
                                await this.chatRepository.createMessage({
                                    id: this.generateId(),
                                    chatId: chat.id,
                                    role: 'assistant',
                                    content: accumulatedAnswer || 'No response',
                                });

                            // 5. Update Title if needed
                            let chatTitle = chat.title;
                            const isNewChat =
                                !chat.title && history.length <= 1;
                            if (isNewChat) {
                                chatTitle = data.message.slice(0, 50);
                                await this.chatRepository.updateChat(chatId, {
                                    title: chatTitle,
                                });
                            }

                            subject.next({
                                type: 'done',
                                data: {
                                    assistantMessage,
                                    isNewChat,
                                },
                            });
                            subject.complete();
                        } catch (err) {
                            subject.error(err);
                        }
                    });

                    stream.on('error', (err) => {
                        this.logger.error('Stream error', err);
                        subject.error(err);
                    });
                },
                error: (err) => {
                    this.logger.error('Http request error', err);
                    subject.error(err);
                },
            });

        return subject.asObservable();
    }

    async updateMessage(messageId: string, user: User, content: string) {
        const message = await this.chatRepository.findMessageById(messageId);
        if (!message) throw new NotFoundException('Message not found');

        // Validate owner
        await this.getChatByIdAndValidateOwner(message.chatId, user);

        return this.chatRepository.updateMessage(messageId, { content });
    }

    async deleteMessage(messageId: string, user: User) {
        const message = await this.chatRepository.findMessageById(messageId);
        if (!message) throw new NotFoundException('Message not found');

        await this.getChatByIdAndValidateOwner(message.chatId, user);
        await this.chatRepository.deleteMessage(messageId);

        return { success: true, message: 'Message deleted' };
    }

    async regenerateFromMessage(messageId: string, user: User) {
        const message = await this.chatRepository.findMessageById(messageId);
        if (!message) throw new NotFoundException('Message not found');
        if (message.role !== 'user')
            throw new NotFoundException(
                'Can only regenerate from user message'
            );

        const chat = await this.getChatByIdAndValidateOwner(
            message.chatId,
            user
        );

        // Delete messages after this one
        await this.chatRepository.deleteMessagesAfter(
            chat.id,
            message.createdAt
        );

        // Re-send the message
        return this.sendMessage(chat.id, user, {
            message: message.content,
            imageUrl: message.imageUrl || undefined,
            documentId: message.documentId || undefined,
            documentName: message.documentName || undefined,
        });
    }

    async regenerateFromMessageStream(
        messageId: string,
        user: User
    ): Promise<Observable<any>> {
        const message = await this.chatRepository.findMessageById(messageId);
        if (!message) throw new NotFoundException('Message not found');
        if (message.role !== 'user')
            throw new NotFoundException(
                'Can only regenerate from user message'
            );

        const chat = await this.getChatByIdAndValidateOwner(
            message.chatId,
            user
        );

        // Delete messages after this one (including this user message, it will be re-created by streamMessage)
        await this.chatRepository.deleteMessagesAfter(
            chat.id,
            message.createdAt
        );

        // Re-send the message with streaming
        return this.streamMessage(chat.id, user, {
            message: message.content,
            imageUrl: message.imageUrl || undefined,
            documentId: message.documentId || undefined,
            documentName: message.documentName || undefined,
        });
    }

    // ==================== DOCUMENTS ====================

    async getDocuments(chatId: string, user: User) {
        await this.getChatByIdAndValidateOwner(chatId, user);
        return this.chatRepository.findDocumentsByChatId(chatId);
    }

    async addDocument(
        chatId: string,
        user: User,
        documentId: string,
        documentName: string
    ) {
        await this.getChatByIdAndValidateOwner(chatId, user);
        return this.chatRepository.addDocument({
            chatId,
            documentId,
            documentName,
        });
    }

    async removeDocument(chatId: string, user: User, documentId: string) {
        await this.getChatByIdAndValidateOwner(chatId, user);
        await this.chatRepository.removeDocument(chatId, documentId);
        return { success: true };
    }

    // ==================== HELPERS ====================

    private async getChatByIdAndValidateOwner(chatId: string, user: User) {
        const chat = await this.chatRepository.findChatById(chatId);
        if (!chat || chat.userId !== user.id) {
            throw new NotFoundException('Chat not found');
        }
        return chat;
    }

    private generateId(): string {
        return (
            Date.now().toString(36) + Math.random().toString(36).substring(2, 9)
        );
    }

    /**
     * Check and process documents on-demand
     * If documents have PENDING/FAILED status, trigger OCR/vectorization via AI service
     */
    private async checkAndProcessDocuments(
        documentIds: string[]
    ): Promise<void> {
        if (!documentIds.length) return;

        // Find documents that need processing
        const pendingDocs = await this.prisma.userStorage.findMany({
            where: {
                id: { in: documentIds },
                processingStatus: { in: ['PENDING', 'FAILED'] },
            },
        });

        if (pendingDocs.length === 0) {
            this.logger.log(
                '[checkAndProcessDocuments] All documents already processed'
            );
            return;
        }

        this.logger.log(
            `[checkAndProcessDocuments] Processing ${pendingDocs.length} pending documents`
        );

        // Process each document sequentially
        for (const doc of pendingDocs) {
            try {
                this.logger.log(
                    `[checkAndProcessDocuments] Processing: ${doc.filename}`
                );

                // Call AI service to OCR/vectorize
                const response = await firstValueFrom(
                    this.httpService.post(
                        `${this.aiServiceUrl}/ai/process-file`,
                        { user_storage_id: doc.id },
                        { timeout: 300000 } // 5 min timeout for OCR
                    )
                );

                if (response.data?.success) {
                    this.logger.log(
                        `[checkAndProcessDocuments] Completed: ${doc.filename}`
                    );
                } else {
                    this.logger.warn(
                        `[checkAndProcessDocuments] Failed: ${doc.filename} - ${response.data?.error || 'Unknown error'}`
                    );
                }
            } catch (error) {
                this.logger.error(
                    `[checkAndProcessDocuments] Error processing ${doc.filename}: ${error.message}`
                );
            }
        }
    }

    private async checkLimits(userId: string, chatId: string) {
        let benefits;
        try {
            if (!this.subscriptionService) {
                this.logger.warn(
                    'SubscriptionService GRPC client not initialized'
                );
                return;
            }
            benefits = await firstValueFrom(
                this.subscriptionService.getUserBenefits({ userId: userId })
            );
        } catch (error) {
            this.logger.error(
                `Error getting subscription benefits: ${error.message}`
            );
            // Fallback to Free defaults
            benefits = {
                tier: 0,
                tier_name: 'Free',
                files_per_month: 5,
                messages_per_minute: 5,
                chat_messages_limit: 30,
            };
        }

        // Check Rate Limit (Messages per minute)
        if (benefits.messages_per_minute !== -1) {
            const count =
                await this.chatRepository.countMessagesLastMinute(userId);
            if (count >= benefits.messages_per_minute) {
                throw new ForbiddenException(
                    `Giới hạn tốc độ: ${benefits.messages_per_minute} tin nhắn/phút. Vui lòng chờ giây lát.`
                );
            }
        }

        // Check Chat Message Limit (Context Length)
        if (benefits.chat_messages_limit !== -1) {
            const count =
                await this.chatRepository.countUserMessagesInChat(chatId);
            if (count >= benefits.chat_messages_limit) {
                throw new ForbiddenException(
                    `Giới hạn hội thoại: ${benefits.chat_messages_limit} tin nhắn. Vui lòng tạo đoạn chat mới.`
                );
            }
        }
    }

    async clearChat(chatId: string, user: User, deleteFiles: boolean = false) {
        // Validate chat ownership
        await this.getChatByIdAndValidateOwner(chatId, user);

        const deletedFiles: string[] = [];

        if (deleteFiles) {
            // Get all document IDs associated with this chat
            const documentIds = await this.chatRepository.getDocumentIds(chatId);

            // Delete each file from R2 and database
            for (const docId of documentIds) {
                try {
                    // Get file info
                    const userStorage = await this.prisma.userStorage.findUnique({
                        where: { id: docId },
                        select: { id: true, filename: true, keyR2: true }
                    });

                    if (userStorage) {
                        // Delete from R2
                        await this.r2UploadService.deleteImage(userStorage.keyR2);

                        // Delete from database (cascade will handle related records)
                        await this.prisma.userStorage.delete({
                            where: { id: docId }
                        });

                        deletedFiles.push(userStorage.filename);
                        this.logger.log(`[clearChat] Deleted file: ${userStorage.filename}`);
                    }
                } catch (error) {
                    this.logger.error(`[clearChat] Error deleting file ${docId}:`, error);
                    // Continue with other files even if one fails
                }
            }
        }

        // Delete the chat (this will cascade delete messages and document links)
        await this.chatRepository.deleteChat(chatId);

        return {
            success: true,
            message: deleteFiles ? 'Chat và files đã được xóa' : 'Chat đã được xóa',
            deletedFiles: deleteFiles ? deletedFiles : undefined
        };
    }
}
