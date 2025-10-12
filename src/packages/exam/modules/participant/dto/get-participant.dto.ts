import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty } from '@nestjs/swagger';
import { PARTICIPANT_STATUS } from '../../../types';

export const GetParticipantsSchema = z.object({
    page: z.number().min(1).default(1),
    limit: z.number().min(1).max(100).default(10),
    examSessionId: z.string().optional(),
    status: z.nativeEnum(PARTICIPANT_STATUS).optional(),
});

export class GetParticipantsDto extends createZodDto(GetParticipantsSchema) {
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
        description:
            'Filter by status: PENDING (0), APPROVED (1), REJECTED (2), or LEFT (3)',
        example: PARTICIPANT_STATUS.APPROVED,
        enum: PARTICIPANT_STATUS,
        required: false,
    })
    status?: PARTICIPANT_STATUS;
}
