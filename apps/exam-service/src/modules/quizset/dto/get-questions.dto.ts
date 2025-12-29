import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty } from '@nestjs/swagger';

export const GetQuestionsSchema = z.object({
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(100).default(10),
});

export class GetQuestionsDto extends createZodDto(GetQuestionsSchema) {
    @ApiProperty({
        description: 'Page number for pagination',
        example: 1,
        required: false,
        default: 1,
    })
    page: number;

    @ApiProperty({
        description: 'Number of items per page for pagination',
        example: 10,
        required: false,
        default: 10,
    })
    limit: number;
}
