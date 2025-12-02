import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty } from '@nestjs/swagger';

// Create Flashcard DTO
export const CreateFlashcardSchema = z.object({
    question: z.string().min(1, { message: 'Question must not be empty' }),
    answer: z.string().min(1, { message: 'Answer must not be empty' }),
});

export class CreateFlashcardDto extends createZodDto(CreateFlashcardSchema) {
    @ApiProperty({
        description: 'The question/front side of flashcard (supports HTML)',
        example: 'What is the capital of France?',
    })
    question: string;

    @ApiProperty({
        description: 'The answer/back side of flashcard (supports HTML)',
        example: 'Paris',
    })
    answer: string;
}

// Update Flashcard DTO
export const UpdateFlashcardSchema = z.object({
    question: z.string().min(1).optional(),
    answer: z.string().min(1).optional(),
});

export class UpdateFlashcardDto extends createZodDto(UpdateFlashcardSchema) {
    @ApiProperty({
        description: 'The question/front side of flashcard',
        example: 'What is the capital of France?',
        required: false,
    })
    question?: string;

    @ApiProperty({
        description: 'The answer/back side of flashcard',
        example: 'Paris',
        required: false,
    })
    answer?: string;
}

// Response DTOs
export class FlashcardResponseDto {
    @ApiProperty({ description: 'Flashcard ID' })
    id: string;

    @ApiProperty({ description: 'The question/front side' })
    question: string;

    @ApiProperty({ description: 'The answer/back side' })
    answer: string;

    @ApiProperty({ description: 'Created at timestamp' })
    createdAt: Date;

    @ApiProperty({ description: 'Updated at timestamp' })
    updatedAt: Date;
}

export class CreateFlashcardResponseDto {
    @ApiProperty({ description: 'Success message' })
    message: string;

    @ApiProperty({
        description: 'Created flashcard',
        type: FlashcardResponseDto,
    })
    flashcard: FlashcardResponseDto;
}

export class UpdateFlashcardResponseDto {
    @ApiProperty({ description: 'Success message' })
    message: string;

    @ApiProperty({
        description: 'Updated flashcard',
        type: FlashcardResponseDto,
    })
    flashcard: FlashcardResponseDto;
}

export class DeleteFlashcardResponseDto {
    @ApiProperty({ description: 'Success message' })
    message: string;
}
