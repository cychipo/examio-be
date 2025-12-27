import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom, Observable, Subject } from 'rxjs';
import { AIChatRepository } from './ai-chat.repository';
import { User } from '@prisma/client';

@Injectable()
export class AIChatService {
    private readonly logger = new Logger(AIChatService.name);
    private readonly aiServiceUrl =
        process.env.AI_SERVICE_URL || 'http://localhost:8000/api';

    constructor(
        private readonly chatRepository: AIChatRepository,
        private readonly httpService: HttpService
    ) {}

    // ==================== CHAT ====================

    async getChats(user: User) {
        const chats = await this.chatRepository.findChatsByUserId(user.id);
        return {
            chats: chats.map((chat) => ({
                id: chat.id,
                userId: chat.userId,
                title: chat.title,
                createdAt: chat.createdAt,
                updatedAt: chat.updatedAt,
                lastMessage: chat.messages[0]?.content || '',
                messageCount: chat._count.messages,
            })),
            total: chats.length,
        };
    }

    async createChat(user: User, title?: string) {
        const id = this.generateId();
        return this.chatRepository.createChat({
            id,
            userId: user.id,
            title: title || '',
        });
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
        // When new message comes, oldest is dropped automatically (slice takes last 30)
        const history = await this.chatRepository.findMessagesByChatId(chatId);
        const historyForAI = history.slice(-30).map((m) => ({
            role: m.role,
            content: m.content,
        }));

        // Get document IDs for RAG
        const docIds =
            data.documentIds ||
            (await this.chatRepository.getDocumentIds(chatId));
        const userStorageId = docIds.length > 0 ? docIds[0] : null;

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
        }
    ): Promise<Observable<any>> {
        const chat = await this.getChatByIdAndValidateOwner(chatId, user);

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

        const docIds =
            data.documentIds ||
            (await this.chatRepository.getDocumentIds(chatId));
        const userStorageId = docIds.length > 0 ? docIds[0] : null;

        const payload = {
            query: data.message,
            history: historyForAI,
            user_storage_id: userStorageId,
        };

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
}
