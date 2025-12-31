import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty } from '@nestjs/swagger';

export const SaveHistoryToQuizsetSchema = z.object({
    quizsetIds: z
        .array(z.string().min(1, { message: 'Quizset ID is required' }))
        .min(1, { message: 'At least one quizset ID is required' }),
    historyId: z.string().min(1, { message: 'History ID is required' }),
});

export class SaveHistoryToQuizsetDto extends createZodDto(
    SaveHistoryToQuizsetSchema
) {
    @ApiProperty({
        description: 'Array of quiz set IDs to save questions to',
        type: [String],
        example: ['quizset12345', 'quizset67890'],
    })
    quizsetIds: string[];

    @ApiProperty({
        description: 'History generated quiz ID (1 history = nhiều câu hỏi)',
        type: String,
        example: 'history123',
    })
    historyId: string;
}
