import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty } from '@nestjs/swagger';
import { Flashcard } from '../../../types';

export const SetFlashcardToFlashcardsetSchema = z.object({
    flashcardsetIds: z
        .array(z.string().min(1, { message: 'Flashcardset ID is required' }))
        .min(1, { message: 'At least one flashcardset ID is required' }),
    flashcards: z
        .array(
            z.object({
                question: z
                    .string()
                    .min(1, { message: 'Question must not be empty' }),
                answer: z
                    .string()
                    .min(1, { message: 'Answer must not be empty' }),
            })
        )
        .min(1, { message: 'At least one flashcard is required' }),
    historyGeneratedFlashcardId: z.string().optional(),
});

export class SetFlashcardToFlashcardsetDto extends createZodDto(
    SetFlashcardToFlashcardsetSchema
) {
    @ApiProperty({
        description: 'Array of flashcard set IDs',
        type: [String],
        example: ['flashcardset123', 'flashcardset456'],
    })
    flashcardsetIds: string[];

    @ApiProperty({
        description: 'Array of flashcards to be added to the flashcard set',
        type: [Object],
        example: [
            {
                question: 'What is the capital of Germany?',
                answer: 'Berlin',
            },
            {
                question: 'What is 5 + 7?',
                answer: '12',
            },
        ],
    })
    flashcards: Flashcard[];
    @ApiProperty({
        description:
            'ID of the history generated flashcard, used to track the source of the flashcards',
        required: false,
        example: 'historyFlashcard12345',
    })
    historyGeneratedFlashcardId?: string;
}
