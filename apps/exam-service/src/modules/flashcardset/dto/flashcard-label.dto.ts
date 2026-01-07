import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty } from '@nestjs/swagger';

// ==================== CREATE LABEL ====================

export const CreateFlashcardLabelSchema = z.object({
    name: z.string().min(1, { message: 'Label name is required' }).max(100),
    description: z.string().max(500).optional(),
    color: z
        .string()
        .regex(/^#[0-9A-Fa-f]{6}$/, { message: 'Invalid hex color format' })
        .optional(),
    order: z.number().int().min(0).optional().default(0),
});

export class CreateFlashcardLabelDto extends createZodDto(CreateFlashcardLabelSchema) {
    @ApiProperty({
        description: 'Name of the label',
        example: 'Chương 1: Đại số',
    })
    name: string;

    @ApiProperty({
        description: 'Description of the label',
        example: 'Các thẻ nhớ về đại số cơ bản',
        required: false,
    })
    description?: string;

    @ApiProperty({
        description: 'Color of the label in hex format',
        example: '#FF5733',
        required: false,
    })
    color?: string;

    @ApiProperty({
        description: 'Order of the label for sorting',
        example: 0,
        required: false,
    })
    order?: number;
}

// ==================== UPDATE LABEL ====================

export const UpdateFlashcardLabelSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional().nullable(),
    color: z
        .string()
        .regex(/^#[0-9A-Fa-f]{6}$/, { message: 'Invalid hex color format' })
        .optional()
        .nullable(),
    order: z.number().int().min(0).optional(),
});

export class UpdateFlashcardLabelDto extends createZodDto(UpdateFlashcardLabelSchema) {
    @ApiProperty({
        description: 'Name of the label',
        example: 'Chương 1: Đại số',
        required: false,
    })
    name?: string;

    @ApiProperty({
        description: 'Description of the label',
        example: 'Các thẻ nhớ về đại số cơ bản',
        required: false,
    })
    description?: string | null;

    @ApiProperty({
        description: 'Color of the label in hex format',
        example: '#FF5733',
        required: false,
    })
    color?: string | null;

    @ApiProperty({
        description: 'Order of the label for sorting',
        example: 0,
        required: false,
    })
    order?: number;
}

// ==================== ASSIGN FLASHCARDS TO LABEL ====================

export const AssignFlashcardsToLabelSchema = z.object({
    flashcardIds: z
        .array(z.string().min(1))
        .min(1, { message: 'At least one flashcard ID is required' }),
});

export class AssignFlashcardsToLabelDto extends createZodDto(
    AssignFlashcardsToLabelSchema
) {
    @ApiProperty({
        description: 'Array of flashcard IDs to assign to the label',
        type: [String],
        example: ['flashcard123', 'flashcard456'],
    })
    flashcardIds: string[];
}