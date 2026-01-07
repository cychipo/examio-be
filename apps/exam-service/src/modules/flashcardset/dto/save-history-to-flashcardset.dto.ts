import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty } from '@nestjs/swagger';

export const SaveHistoryToFlashcardsetSchema = z.object({
    flashcardsetIds: z
        .array(z.string().min(1, { message: 'Flashcardset ID is required' }))
        .min(1, { message: 'At least one flashcardset ID is required' }),
    historyId: z.string().min(1, { message: 'History ID is required' }),
    // Optional: assign to existing label by ID
    labelId: z.string().optional(),
    // Optional: create new label with this name (if labelId is not provided)
    labelName: z.string().max(100).optional(),
    // Optional: color for new label
    labelColor: z
        .string()
        .regex(/^#[0-9A-Fa-f]{6}$/)
        .optional(),
});

export class SaveHistoryToFlashcardsetDto extends createZodDto(
    SaveHistoryToFlashcardsetSchema
) {
    @ApiProperty({
        description: 'Array of flashcard set IDs to save flashcards to',
        type: [String],
        example: ['flashcardset123', 'flashcardset456'],
    })
    flashcardsetIds: string[];

    @ApiProperty({
        description:
            'History generated flashcard ID (1 history = nhiều flashcards)',
        type: String,
        example: 'history123',
    })
    historyId: string;

    @ApiProperty({
        description: 'Existing label ID to assign flashcards to',
        type: String,
        required: false,
        example: 'label123',
    })
    labelId?: string;

    @ApiProperty({
        description:
            'Name for new label (creates label if labelId not provided)',
        type: String,
        required: false,
        example: 'Chương 1: Đại số',
    })
    labelName?: string;

    @ApiProperty({
        description: 'Color for new label in hex format',
        type: String,
        required: false,
        example: '#FF5733',
    })
    labelColor?: string;
}
