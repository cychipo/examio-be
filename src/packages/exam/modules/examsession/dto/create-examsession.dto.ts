import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty } from '@nestjs/swagger';

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
}
