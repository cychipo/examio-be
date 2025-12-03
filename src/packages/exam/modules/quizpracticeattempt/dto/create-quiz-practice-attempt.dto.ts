import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const CreateQuizPracticeAttemptSchema = z.object({
    quizSetId: z.string().min(1, { message: 'Quiz set ID is required' }),
    type: z.number().int().min(0).max(2).optional().default(0),
    timeLimitMinutes: z.number().positive().optional().nullable(),
});

export class CreateQuizPracticeAttemptDto extends createZodDto(
    CreateQuizPracticeAttemptSchema
) {
    @ApiProperty({
        description: 'ID của quiz set',
        example: 'quizset_123456',
    })
    quizSetId: string;

    @ApiPropertyOptional({
        description: 'Loại practice (0: Normal, 1: Review Wrong, 2: Learn New)',
        example: 0,
        default: 0,
    })
    type?: number;

    @ApiPropertyOptional({
        description: 'Thời gian giới hạn (phút), null = không giới hạn',
        example: 30,
    })
    timeLimitMinutes?: number | null;
}
