import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ================== SCHEMAS ==================

export const CreateChatSchema = z.object({
    title: z.string().max(100).optional(),
});

export const SendMessageSchema = z.object({
    message: z
        .string()
        .min(1, { message: 'Message must not be empty' })
        .max(1000, { message: 'Message must be less than 5000 characters' }),
    imageUrl: z.string().optional(),
    documentId: z.string().optional(),
    documentIds: z.array(z.string()).optional(),
    documentName: z.string().optional(),
});

export const UpdateChatSchema = z.object({
    title: z
        .string()
        .min(1, { message: 'Title must not be empty' })
        .max(100, { message: 'Title must be less than 100 characters' }),
});

export const UpdateMessageSchema = z.object({
    content: z
        .string()
        .min(1, { message: 'Content must not be empty' })
        .max(1000, { message: 'Content must be less than 1000 characters' }),
});

// ================== REQUEST DTOs ==================

export class CreateChatDto extends createZodDto(CreateChatSchema) {
    @ApiPropertyOptional({ description: 'Title for the chat (optional)' })
    title?: string;
}

export class SendMessageDto extends createZodDto(SendMessageSchema) {
    @ApiProperty({ description: 'Message content' })
    message: string;

    @ApiPropertyOptional({ description: 'Image URL if sending with image' })
    imageUrl?: string;

    @ApiPropertyOptional({ description: 'Document ID for PDF context' })
    documentId?: string;

    @ApiPropertyOptional({ description: 'List of Document IDs for PDF context' })
    documentIds?: string[];

    @ApiPropertyOptional({ description: 'Document name for display' })
    documentName?: string;
}

export class UpdateChatDto extends createZodDto(UpdateChatSchema) {
    @ApiProperty({ description: 'New title for the chat' })
    title: string;
}

export class UpdateMessageDto extends createZodDto(UpdateMessageSchema) {
    @ApiProperty({ description: 'New content for the message' })
    content: string;
}

// ================== RESPONSE DTOs ==================

export class MessageResponseDto {
    @ApiProperty()
    id: string;

    @ApiProperty()
    chatId: string;

    @ApiProperty({ enum: ['user', 'assistant'] })
    role: string;

    @ApiProperty()
    content: string;

    @ApiPropertyOptional()
    imageUrl?: string;

    @ApiPropertyOptional()
    documentId?: string;

    @ApiPropertyOptional()
    documentName?: string;

    @ApiProperty()
    createdAt: Date;
}

export class ChatResponseDto {
    @ApiProperty()
    id: string;

    @ApiProperty()
    userId: string;

    @ApiProperty()
    title: string;

    @ApiProperty()
    createdAt: Date;

    @ApiProperty()
    updatedAt: Date;

    @ApiPropertyOptional({ type: [MessageResponseDto] })
    messages?: MessageResponseDto[];

    @ApiPropertyOptional({ description: 'Preview of last message' })
    lastMessage?: string;

    @ApiPropertyOptional({ description: 'Number of messages in chat' })
    messageCount?: number;
}

export class ChatListResponseDto {
    @ApiProperty({ type: [ChatResponseDto] })
    chats: ChatResponseDto[];

    @ApiProperty()
    total: number;
}

export class SendMessageResponseDto {
    @ApiProperty()
    success: boolean;

    @ApiPropertyOptional()
    userMessage?: MessageResponseDto;

    @ApiPropertyOptional()
    assistantMessage?: MessageResponseDto;

    @ApiPropertyOptional()
    error?: string;

    @ApiPropertyOptional({ description: 'Chat title if auto-generated' })
    chatTitle?: string;
}
