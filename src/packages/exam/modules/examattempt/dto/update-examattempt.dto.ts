import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty } from '@nestjs/swagger';
import { EXAM_ATTEMPT_STATUS } from '../../../types';

export const UpdateExamAttemptDtoSchema = z.object({
    score: z.number().min(0).max(100).optional(),
    violationCount: z.number().int().min(0).optional(),
    status: z.nativeEnum(EXAM_ATTEMPT_STATUS).optional(),
});

export class UpdateExamAttemptDto extends createZodDto(
    UpdateExamAttemptDtoSchema
) {
    @ApiProperty({
        description: 'Score of the exam attempt',
        example: 85.5,
        required: false,
    })
    score?: number;

    @ApiProperty({
        description: 'Number of violations',
        example: 0,
        required: false,
    })
    violationCount?: number;

    @ApiProperty({
        description: 'Status: IN_PROGRESS (0), COMPLETED (1), or CANCELLED (2)',
        example: EXAM_ATTEMPT_STATUS.COMPLETED,
        enum: EXAM_ATTEMPT_STATUS,
        required: false,
    })
    status?: EXAM_ATTEMPT_STATUS;
}
