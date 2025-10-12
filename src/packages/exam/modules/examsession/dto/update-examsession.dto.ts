import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty } from '@nestjs/swagger';
import { EXAM_SESSION_STATUS } from '../../../types';

export const UpdateExamSessionDtoSchema = z.object({
    status: z.nativeEnum(EXAM_SESSION_STATUS).optional(),
    startTime: z.string().datetime().optional(),
    endTime: z.string().datetime().optional(),
    autoJoinByLink: z.boolean().optional(),
});

export class UpdateExamSessionDto extends createZodDto(
    UpdateExamSessionDtoSchema
) {
    @ApiProperty({
        description: 'Status: UPCOMING (0), ONGOING (1), or ENDED (2)',
        example: EXAM_SESSION_STATUS.ONGOING,
        enum: EXAM_SESSION_STATUS,
        required: false,
    })
    status?: EXAM_SESSION_STATUS;

    @ApiProperty({
        description: 'Start time of the exam session',
        example: '2025-10-15T10:00:00Z',
        required: false,
    })
    startTime?: string;

    @ApiProperty({
        description: 'End time of the exam session',
        example: '2025-10-15T12:00:00Z',
        required: false,
    })
    endTime?: string;

    @ApiProperty({
        description: 'Whether participants can auto-join by link',
        example: false,
        required: false,
    })
    autoJoinByLink?: boolean;
}
