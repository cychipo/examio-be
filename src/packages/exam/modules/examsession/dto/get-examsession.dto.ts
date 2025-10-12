import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty } from '@nestjs/swagger';
import { EXAM_SESSION_STATUS } from '../../../types';

export const GetExamSessionsSchema = z.object({
    page: z.number().min(1).default(1),
    limit: z.number().min(1).max(100).default(10),
    examRoomId: z.string().optional(),
    status: z.nativeEnum(EXAM_SESSION_STATUS).optional(),
});

export class GetExamSessionsDto extends createZodDto(GetExamSessionsSchema) {
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
        description: 'Filter by exam room ID',
        example: 'examroom_123456',
        required: false,
    })
    examRoomId?: string;

    @ApiProperty({
        description:
            'Filter by status: UPCOMING (0), ONGOING (1), or ENDED (2)',
        example: EXAM_SESSION_STATUS.ONGOING,
        enum: EXAM_SESSION_STATUS,
        required: false,
    })
    status?: EXAM_SESSION_STATUS;
}
