import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty } from '@nestjs/swagger';
import { Quizz } from 'src/packages/exam/types';

export const SetQuizzToQuizsetSchema = z.object({
    quizsetIds: z
        .array(z.string().min(1, { message: 'Quizset ID is required' }))
        .min(1, { message: 'At least one quizset ID is required' }),
    quizzes: z
        .array(
            z.object({
                question: z
                    .array(z.string())
                    .min(1, { message: 'Question must not be empty' }),
                options: z
                    .array(z.string())
                    .min(2, { message: 'At least two options are required' }),
                answer: z
                    .string()
                    .min(1, { message: 'Answer must not be empty' }),
            })
        )
        .min(1, { message: 'At least one quiz is required' }),
});

export class SetQuizzToQuizsetDto extends createZodDto(
    SetQuizzToQuizsetSchema
) {
    @ApiProperty({
        description: 'Array of quiz set IDs',
        type: [String],
        example: ['quizset12345', 'quizset67890'],
    })
    quizsetIds: string[];

    @ApiProperty({
        description: 'Array of quizzes to be added to the quiz set',
        type: [Object],
        example: [
            {
                question: 'What is 2 + 2?',
                options: ['3', '4', '5', '6'],
                answer: '4',
            },
            {
                question: 'What is the capital of France?',
                options: ['Berlin', 'Madrid', 'Paris', 'Rome'],
                answer: 'Paris',
            },
        ],
    })
    quizzes: Quizz[];
}
