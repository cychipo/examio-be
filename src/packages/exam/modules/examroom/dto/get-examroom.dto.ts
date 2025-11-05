import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty } from '@nestjs/swagger';
import { ASSESS_TYPE } from '../../../types';

export const GetExamRoomsSchema = z.object({
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(100).default(10),
    search: z.string().optional(),
    assessType: z.coerce
        .number()
        .optional()
        .transform((val) => val as ASSESS_TYPE),
    quizSetId: z.string().optional(),
});

export class GetExamRoomsDto extends createZodDto(GetExamRoomsSchema) {
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
        description: 'Search term to filter exam rooms by title or description',
        example: 'midterm',
        required: false,
    })
    search?: string;

    @ApiProperty({
        description: 'Filter by assessment type: PUBLIC (0) or PRIVATE (1)',
        example: ASSESS_TYPE.PUBLIC,
        enum: ASSESS_TYPE,
        required: false,
    })
    assessType?: ASSESS_TYPE;

    @ApiProperty({
        description: 'Filter by quiz set ID',
        example: 'quiz_123456',
        required: false,
    })
    quizSetId?: string;
}
