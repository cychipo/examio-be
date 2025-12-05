import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty } from '@nestjs/swagger';
import { EXAM_SESSION_STATUS, ASSESS_TYPE } from '../../../types';

export const UpdateExamSessionDtoSchema = z.object({
    status: z.nativeEnum(EXAM_SESSION_STATUS).optional(),
    startTime: z.string().datetime().optional(),
    endTime: z.string().datetime().optional(),
    autoJoinByLink: z.boolean().optional(),
    // Security and access control fields
    assessType: z.nativeEnum(ASSESS_TYPE).optional(),
    allowRetake: z.boolean().optional(),
    maxAttempts: z.number().int().min(1).optional(),
    accessCode: z.string().length(6).optional().nullable(),
    whitelist: z.array(z.string()).optional(),
    showAnswersAfterSubmit: z.boolean().optional(),
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

    @ApiProperty({
        description: 'Assessment type: PUBLIC (0) or PRIVATE (1)',
        example: ASSESS_TYPE.PUBLIC,
        enum: ASSESS_TYPE,
        required: false,
    })
    assessType?: ASSESS_TYPE;

    @ApiProperty({
        description: 'Whether participants can retake the exam',
        example: false,
        required: false,
    })
    allowRetake?: boolean;

    @ApiProperty({
        description: 'Maximum number of attempts allowed',
        example: 1,
        required: false,
    })
    maxAttempts?: number;

    @ApiProperty({
        description: '6-digit access code for private sessions',
        example: '123456',
        required: false,
    })
    accessCode?: string | null;

    @ApiProperty({
        description: 'List of user IDs who can access this session',
        example: ['user_123', 'user_456'],
        required: false,
    })
    whitelist?: string[];

    @ApiProperty({
        description: 'Whether to show detailed answers after submission',
        example: true,
        required: false,
    })
    showAnswersAfterSubmit?: boolean;
}
