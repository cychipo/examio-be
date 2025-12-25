import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty } from '@nestjs/swagger';

// Create Question DTO
export const CreateQuestionSchema = z.object({
    question: z.string().min(1, { message: 'Question must not be empty' }),
    options: z
        .array(z.string())
        .min(2, { message: 'At least two options are required' }),
    answer: z.string().min(1, { message: 'Answer must not be empty' }),
});

export class CreateQuestionDto extends createZodDto(CreateQuestionSchema) {
    @ApiProperty({
        description: 'The question text (supports HTML)',
        example: 'What is 2 + 2?',
    })
    question: string;

    @ApiProperty({
        description: 'Array of answer options',
        type: [String],
        example: ['3', '4', '5', '6'],
    })
    options: string[];

    @ApiProperty({
        description:
            'The correct answer (letter A, B, C, D or the answer text)',
        example: 'B',
    })
    answer: string;
}

// Update Question DTO
export const UpdateQuestionSchema = z.object({
    question: z.string().min(1).optional(),
    options: z.array(z.string()).min(2).optional(),
    answer: z.string().min(1).optional(),
});

export class UpdateQuestionDto extends createZodDto(UpdateQuestionSchema) {
    @ApiProperty({
        description: 'The question text (supports HTML)',
        example: 'What is 2 + 2?',
        required: false,
    })
    question?: string;

    @ApiProperty({
        description: 'Array of answer options',
        type: [String],
        example: ['3', '4', '5', '6'],
        required: false,
    })
    options?: string[];

    @ApiProperty({
        description: 'The correct answer',
        example: 'B',
        required: false,
    })
    answer?: string;
}

// Response DTOs
export class QuestionResponseDto {
    @ApiProperty({ description: 'Question ID' })
    id: string;

    @ApiProperty({ description: 'The question text' })
    question: string;

    @ApiProperty({ description: 'Answer options', type: [String] })
    options: string[];

    @ApiProperty({ description: 'Correct answer' })
    answer: string;

    @ApiProperty({ description: 'Created at timestamp' })
    createdAt: Date;

    @ApiProperty({ description: 'Updated at timestamp' })
    updatedAt: Date;
}

export class CreateQuestionResponseDto {
    @ApiProperty({ description: 'Success message' })
    message: string;

    @ApiProperty({ description: 'Created question', type: QuestionResponseDto })
    question: QuestionResponseDto;
}

export class UpdateQuestionResponseDto {
    @ApiProperty({ description: 'Success message' })
    message: string;

    @ApiProperty({ description: 'Updated question', type: QuestionResponseDto })
    question: QuestionResponseDto;
}

export class DeleteQuestionResponseDto {
    @ApiProperty({ description: 'Success message' })
    message: string;
}
