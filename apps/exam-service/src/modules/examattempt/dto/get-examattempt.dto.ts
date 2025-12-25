import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty } from '@nestjs/swagger';
import { EXAM_ATTEMPT_STATUS } from '../../../types';

export const GetExamAttemptsSchema = z.object({
    page: z.number().min(1).default(1),
    limit: z.number().min(1).max(100).default(10),
    examSessionId: z.string().optional(),
    userId: z.string().optional(),
    status: z.nativeEnum(EXAM_ATTEMPT_STATUS).optional(),
});

export class GetExamAttemptsDto extends createZodDto(GetExamAttemptsSchema) {
    @ApiProperty({
        description: 'Page number for pagination',
        example: 1,
        required: false,
    })
    page: number;

    @ApiProperty({
        description: 'Number of items per page for pagination',
        example: 10,
        required: false,
    })
    limit: number;

    @ApiProperty({
        description: 'Filter by exam session ID',
        example: 'examsession_123456',
        required: false,
    })
    examSessionId?: string;

    @ApiProperty({
        description: 'Filter by user ID',
        example: 'user_123456',
        required: false,
    })
    userId?: string;

    @ApiProperty({
        description:
            'Filter by status: IN_PROGRESS (0), COMPLETED (1), or CANCELLED (2)',
        example: EXAM_ATTEMPT_STATUS.COMPLETED,
        enum: EXAM_ATTEMPT_STATUS,
        required: false,
    })
    status?: EXAM_ATTEMPT_STATUS;
}
