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
     * Get document content from UserStorage and Document tables
     */
    private async getDocumentContext(
        documentId: string,
        userId: string
    ): Promise<string | null> {
        try {
            // Verify user owns the document
            const userStorage = await this.prisma.userStorage.findFirst({
                where: {
                    id: documentId,
                    userId: userId,
                },
            });

            if (!userStorage) {
                return null;
            }

            // Get all document chunks
            const documents = await this.prisma.document.findMany({
                where: {
                    userStorageId: documentId,
                },
                orderBy: {
                    pageRange: 'asc',
                },
                select: {
                    content: true,
                    pageRange: true,
                },
            });

            if (documents.length === 0) {
                return null;
            }

            // Combine all content (limit to ~4000 chars to leave room for prompt)
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

        // Remove markdown formatting
        processed = processed.replace(/\*\*/g, '');
        processed = processed.replace(/##/g, '');
        processed = processed.replace(/\*/g, '');
        processed = processed.replace(/#/g, '');

        // Remove bullet points and list markers
        processed = processed.replace(/^[-•]\s*/gm, '');
        processed = processed.replace(/^\d+\.\s*/gm, '');

        // Replace multiple newlines with period + space
        processed = processed.replace(/\n\n+/g, '. ');
        processed = processed.replace(/\n/g, ' ');

        // Clean up multiple spaces and periods
        processed = processed.replace(/\s+/g, ' ');
        processed = processed.replace(/\.+/g, '.');
        processed = processed.replace(/\.\s*\./g, '.');

        return processed.trim();
    }

    /**
     * Main chat processing method
     */
    async processChat(
        dto: ChatRequestDto,
        userId: string
    ): Promise<ChatResponseDto> {
        try {
            // Get document context if documentId provided
            let documentContext: string | null = null;
            if (dto.documentId) {
                documentContext = await this.getDocumentContext(
                    dto.documentId,
                    userId
                );
            }

            // Build prompt using PromptUtils
            const prompt = this.promptUtils.buildVirtualTeacherPrompt(
                dto.message,
                documentContext
            );

            // Call Gemini API using AIService
            const response = await this.aiService.generateContent(prompt);

            if (!response) {
                return {
                    success: false,
                    response:
                        'Xin lỗi, tôi không thể tạo câu trả lời. Vui lòng thử lại.',
                    error: 'Empty response from AI',
                };
            }

            // Post-process for TTS
            const processedResponse = this.postProcessResponse(response);

            return {
                success: true,
                response: processedResponse,
            };
        } catch (error: any) {
            console.error('❌ Error in processChat:', error);

            // Check for rate limit / quota errors
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
            console.log(`🖼️ Processing image chat for user ${userId}`);

            // Fetch image from URL
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

            // Determine mime type from response headers or URL
            const contentType =
                imageResponse.headers.get('content-type') || 'image/jpeg';

            // Build prompt with image context
            const textPrompt = this.promptUtils.buildVirtualTeacherPrompt(
                message,
                null
            );

            // Call Gemini API with image content
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

            // Post-process for TTS
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
}
