import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiPropertyOptional } from '@nestjs/swagger';

export const UpdateQuizPracticeAttemptSchema = z.object({
    answers: z.record(z.string(), z.string()).optional(),
    currentIndex: z.number().int().min(0).optional(),
    markedQuestions: z.array(z.string()).optional(),
    timeSpentSeconds: z.number().int().min(0).optional(),
    timeLimitMinutes: z.number().positive().nullable().optional(),
    isSubmitted: z.boolean().optional(),
});

export class UpdateQuizPracticeAttemptDto extends createZodDto(
    UpdateQuizPracticeAttemptSchema
) {
    @ApiPropertyOptional({
        description: 'Các câu trả lời - JSON object { questionId: answer }',
        example: { q1: 'A', q2: 'B' },
    })
    answers?: Record<string, string>;

    @ApiPropertyOptional({
        description: 'Câu hỏi hiện tại (index)',
        example: 0,
    })
    currentIndex?: number;

    @ApiPropertyOptional({
        description: 'Danh sách câu hỏi đánh dấu',
        example: ['q1', 'q5'],
    })
    markedQuestions?: string[];

    @ApiPropertyOptional({
        description: 'Thời gian đã làm (giây)',
        example: 120,
    })
    timeSpentSeconds?: number;

    @ApiPropertyOptional({
        description: 'Giới hạn thời gian (phút), null = không giới hạn',
        example: 30,
    })
    timeLimitMinutes?: number | null;

    @ApiPropertyOptional({
        description: 'Đánh dấu đã nộp bài',
        example: false,
    })
    isSubmitted?: boolean;
}
