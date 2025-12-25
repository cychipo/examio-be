import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const ChatRequestSchema = z.object({
    message: z
        .string()
        .min(1, { message: 'Message must not be empty' })
        .max(5000, { message: 'Message must be less than 5000 characters' }),
    documentId: z.string().optional(),
    documentIds: z.array(z.string()).optional(),
});

export class ChatRequestDto extends createZodDto(ChatRequestSchema) {
    @ApiProperty({
        description: 'User message to send to AI teacher',
        example: 'Giải thích về định luật Newton cho tôi',
    })
    message: string;

    @ApiPropertyOptional({
        description: 'Document ID (UserStorage ID) to use as context (legacy)',
        example: 'abc123',
    })
    documentId?: string;

    @ApiPropertyOptional({
        description: 'List of Document IDs to use as context',
        example: ['abc123', 'def456'],
    })
    documentIds?: string[];
}

export class VTChatResponseDto {
    @ApiProperty({ description: 'Whether the request was successful' })
    success: boolean;

    @ApiProperty({ description: 'AI teacher response message' })
    response: string;

    @ApiPropertyOptional({ description: 'Error message if any' })
    error?: string;
}
