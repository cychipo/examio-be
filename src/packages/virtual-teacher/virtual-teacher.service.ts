import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { AIService } from '../ai/ai.service';
import { PromptUtils } from 'src/utils/prompt';
import { ChatRequestDto, ChatResponseDto } from './dto/chat.dto';

@Injectable()
export class VirtualTeacherService {
    private readonly promptUtils = new PromptUtils();

    constructor(
        private readonly prisma: PrismaService,
        private readonly aiService: AIService
    ) {}

    /**
     * Get relevant document content using semantic search (vector-based)
     * Creates embedding from user's query and finds most relevant chunks
     */
    private async getDocumentContextSemantic(
        documentId: string,
        userId: string,
        userQuery: string
    ): Promise<string | null> {
        try {
            const userStorage = await this.prisma.userStorage.findFirst({
                where: {
                    id: documentId,
                    userId: userId,
                },
            });

            if (!userStorage) {
                return null;
            }

            // Use semantic search to find relevant chunks
            const relevantContent = await this.aiService.searchDocumentsByQuery(
                documentId,
                userQuery,
                5 // Top 5 most relevant chunks
            );

            return relevantContent;
        } catch (error) {
            console.error('Error getting document context:', error);
            return null;
        }
    }

    /**
     * Fallback: Get document content sequentially (for when no specific query)
     */
    private async getDocumentContext(
        documentId: string,
        userId: string
    ): Promise<string | null> {
        try {
            const userStorage = await this.prisma.userStorage.findFirst({
                where: {
                    id: documentId,
                    userId: userId,
                },
            });

            if (!userStorage) {
                return null;
            }

            const documents = await this.prisma.document.findMany({
                where: {
                    userStorageId: documentId,
                },
                orderBy: {
                    pageRange: 'asc',
                },
                take: 10,
                select: {
                    content: true,
                    pageRange: true,
                },
            });

            if (documents.length === 0) {
                return null;
            }

            let combinedContent = '';
            for (const doc of documents) {
                if (combinedContent.length + doc.content.length > 4000) {
                    combinedContent += doc.content.substring(
                        0,
                        4000 - combinedContent.length
                    );
                    break;
                }
                combinedContent += doc.content + '\n\n';
            }

            return combinedContent.trim();
        } catch (error) {
            console.error('Error getting document context:', error);
            return null;
        }
    }

    /**
     * Post-process the AI response to make it suitable for TTS
     */
    private postProcessResponse(response: string): string {
        let processed = response;

        processed = processed.replace(/\*\*/g, '');
        processed = processed.replace(/##/g, '');
        processed = processed.replace(/\*/g, '');
        processed = processed.replace(/#/g, '');

        processed = processed.replace(/^[-•]\s*/gm, '');
        processed = processed.replace(/^\d+\.\s*/gm, '');

        processed = processed.replace(/\n\n+/g, '. ');
        processed = processed.replace(/\n/g, ' ');

        processed = processed.replace(/\s+/g, ' ');
        processed = processed.replace(/\.+/g, '.');
        processed = processed.replace(/\.\s*\./g, '.');

        return processed.trim();
    }

    /**
     * Detect if user's message relates to document (RAG) or is a general question
     * Uses a quick LLM call to classify intent
     */
    async detectIntent(
        message: string,
        recentHistory: Array<{ role: 'user' | 'model'; content: string }>
    ): Promise<'RAG' | 'GENERAL'> {
        try {
            // Format recent history for context
            const historyText = recentHistory
                .slice(-6) // Last 3 exchanges
                .map(
                    (h) =>
                        `${h.role === 'user' ? 'User' : 'AI'}: ${h.content.substring(0, 200)}`
                )
                .join('\n');

            const prompt = `Nhiệm vụ: Xác định câu hỏi mới có liên quan đến tài liệu/file đã thảo luận trước đó hay không.

Lịch sử hội thoại gần đây:
${historyText || '(Không có lịch sử)'}

Câu hỏi mới: "${message}"

Quy tắc:
- Trả lời "RAG" nếu câu hỏi liên quan đến tài liệu, file, nội dung đã đề cập
- Trả lời "GENERAL" nếu là câu hỏi chung, hỏi thời tiết, hỏi về chủ đề khác

Chỉ trả lời 1 từ: RAG hoặc GENERAL`;

            const result = await this.aiService.generateContent(prompt);
            const trimmed = (result || 'RAG').trim().toUpperCase();

            console.log(
                `[Intent Detection] Message: "${message.substring(0, 50)}..." → ${trimmed.includes('RAG') ? 'RAG' : 'GENERAL'}`
            );

            return trimmed.includes('RAG') ? 'RAG' : 'GENERAL';
        } catch (error) {
            console.error('Error detecting intent:', error);
            // Default to RAG to be safe (use document context if available)
            return 'RAG';
        }
    }

    /**
     * Main chat processing method
     */
    async processChat(
        dto: ChatRequestDto,
        userId: string
    ): Promise<ChatResponseDto> {
        try {
            let documentContext: string | null = null;
            if (dto.documentId) {
                documentContext = await this.getDocumentContext(
                    dto.documentId,
                    userId
                );
            }

            const prompt = this.promptUtils.buildVirtualTeacherPrompt(
                dto.message,
                documentContext
            );

            const response = await this.aiService.generateContent(prompt);

            if (!response) {
                return {
                    success: false,
                    response:
                        'Xin lỗi, tôi không thể tạo câu trả lời. Vui lòng thử lại.',
                    error: 'Empty response from AI',
                };
            }

            const processedResponse = this.postProcessResponse(response);

            return {
                success: true,
                response: processedResponse,
            };
        } catch (error: any) {
            console.error('❌ Error in processChat:', error);

            const isQuotaError =
                error?.status === 429 ||
                error?.error?.code === 429 ||
                error?.message?.includes('429') ||
                error?.message?.includes('quota') ||
                error?.message?.includes('RESOURCE_EXHAUSTED') ||
                error?.message?.includes('rate limit');

            if (isQuotaError) {
                return {
                    success: false,
                    response:
                        'Hệ thống đang bảo trì. Vui lòng thử lại sau ít phút.',
                    error: 'Hệ thống đang bảo trì. Vui lòng thử lại sau ít phút.',
                };
            }

            return {
                success: false,
                response:
                    'Xin lỗi, tôi gặp lỗi khi xử lý câu hỏi của bạn. Vui lòng thử lại sau.',
                error: 'Processing error',
            };
        }
    }

    /**
     * Process chat with image input
     * Fetches image from URL, converts to base64, and sends to Gemini
     */
    async processImageChat(
        imageUrl: string,
        message: string,
        userId: string
    ): Promise<ChatResponseDto> {
        try {
            const imageResponse = await fetch(imageUrl);
            if (!imageResponse.ok) {
                return {
                    success: false,
                    response: 'Không thể tải hình ảnh. Vui lòng thử lại.',
                    error: 'Failed to fetch image',
                };
            }

            const imageArrayBuffer = await imageResponse.arrayBuffer();
            const base64ImageData =
                Buffer.from(imageArrayBuffer).toString('base64');

            const contentType =
                imageResponse.headers.get('content-type') || 'image/jpeg';

            const textPrompt = this.promptUtils.buildVirtualTeacherPrompt(
                message,
                null
            );

            const result = await this.aiService.generateContentWithImage(
                textPrompt,
                base64ImageData,
                contentType
            );

            if (!result) {
                return {
                    success: false,
                    response:
                        'Xin lỗi, tôi không thể phân tích hình ảnh. Vui lòng thử lại.',
                    error: 'Empty response from AI',
                };
            }

            const processedResponse = this.postProcessResponse(result);

            return {
                success: true,
                response: processedResponse,
            };
        } catch (error: any) {
            console.error('❌ Error in processImageChat:', error);

            const isQuotaError =
                error?.status === 429 ||
                error?.error?.code === 429 ||
                error?.message?.includes('quota');

            if (isQuotaError) {
                return {
                    success: false,
                    response:
                        'Hệ thống đang bảo trì. Vui lòng thử lại sau ít phút.',
                    error: 'Quota exceeded',
                };
            }

            return {
                success: false,
                response:
                    'Xin lỗi, tôi gặp lỗi khi xử lý hình ảnh. Vui lòng thử lại sau.',
                error: 'Image processing error',
            };
        }
    }

    /**
     * Streaming chat processing - yields text chunks as they arrive
     */
    async *processChatStream(
        dto: ChatRequestDto,
        userId: string
    ): AsyncGenerator<string, void, unknown> {
        let documentContext: string | null = null;
        if (dto.documentId) {
            documentContext = await this.getDocumentContext(
                dto.documentId,
                userId
            );
        }

        const prompt = this.promptUtils.buildVirtualTeacherPrompt(
            dto.message,
            documentContext
        );

        for await (const chunk of this.aiService.generateContentStream(
            prompt
        )) {
            yield chunk;
        }
    }

    /**
     * Streaming chat with image processing
     */
    async *processImageChatStream(
        imageUrl: string,
        message: string,
        userId: string
    ): AsyncGenerator<string, void, unknown> {
        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) {
            throw new Error('Failed to fetch image');
        }

        const imageArrayBuffer = await imageResponse.arrayBuffer();
        const base64ImageData =
            Buffer.from(imageArrayBuffer).toString('base64');

        const contentType =
            imageResponse.headers.get('content-type') || 'image/jpeg';

        const textPrompt = this.promptUtils.buildVirtualTeacherPrompt(
            message,
            null
        );

        for await (const chunk of this.aiService.generateContentWithImageStream(
            textPrompt,
            base64ImageData,
            contentType
        )) {
            yield chunk;
        }
    }

    /**
     * Streaming chat with conversation history for context-aware responses
     * Uses semantic search for document context when documentId is provided
     */
    async *processChatWithHistoryStream(
        message: string,
        history: Array<{ role: 'user' | 'model'; content: string }>,
        documentId?: string | null,
        userId?: string
    ): AsyncGenerator<string, void, unknown> {
        // Get document context using semantic search if documentId provided
        let documentContext: string | null = null;
        if (documentId && userId) {
            documentContext = await this.getDocumentContextSemantic(
                documentId,
                userId,
                message // Use user's message for semantic relevance
            );
        }

        const systemPrompt = this.promptUtils.buildVirtualTeacherPrompt(
            '',
            documentContext
        );

        for await (const chunk of this.aiService.generateChatWithHistoryStream(
            message,
            history,
            systemPrompt
        )) {
            yield chunk;
        }
    }
}
