import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty } from '@nestjs/swagger';

export const SaveHistoryToFlashcardsetSchema = z.object({
    flashcardsetIds: z
        .array(z.string().min(1, { message: 'Flashcardset ID is required' }))
        .min(1, { message: 'At least one flashcardset ID is required' }),
    historyId: z.string().min(1, { message: 'History ID is required' }),
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
}
