import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty } from '@nestjs/swagger';
import { ASSESS_TYPE } from '../../../types';

export const CreateExamSessionSchema = z.object({
    examRoomId: z.string().min(1, { message: 'Exam room ID is required' }),
    startTime: z
        .string()
        .datetime({ message: 'Start time must be a valid datetime' }),
    endTime: z
        .string()
        .datetime({ message: 'End time must be a valid datetime' })
        .optional(),
    autoJoinByLink: z.boolean().optional().default(false),
    // Security and access control fields
    assessType: z
        .nativeEnum(ASSESS_TYPE)
        .optional()
        .default(ASSESS_TYPE.PUBLIC),
    allowRetake: z.boolean().optional().default(false),
    maxAttempts: z.number().int().min(1).optional().default(1),
    accessCode: z.string().length(6).optional().nullable(),
    whitelist: z.array(z.string()).optional().default([]),
    showAnswersAfterSubmit: z.boolean().optional().default(true),
    passingScore: z.number().min(0).max(100).optional().default(40),
});

export class CreateExamSessionDto extends createZodDto(
    CreateExamSessionSchema
) {
    @ApiProperty({
        description: 'ID of the exam room',
        example: 'examroom_123456',
    })
    examRoomId: string;

    @ApiProperty({
        description: 'Start time of the exam session',
        example: '2025-10-15T10:00:00Z',
    })
    startTime: string;

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

    @ApiProperty({
        description: 'Minimum score percentage to pass (0-100, 0 = no minimum)',
        example: 50,
        required: false,
    })
    passingScore?: number;
}
