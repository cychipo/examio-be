import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty } from '@nestjs/swagger';

// ================== SCHEMAS ==================

export const GetTransactionsSchema = z.object({
    page: z.coerce.number().min(1).default(1),
    size: z.coerce.number().min(1).max(50).default(10),
});

// ================== REQUEST DTOs ==================

export class GetTransactionsDto extends createZodDto(GetTransactionsSchema) {
    @ApiProperty({ description: 'Trang hiện tại', example: 1, required: false })
    page: number;

    @ApiProperty({
        description: 'Số lượng mỗi trang',
        example: 10,
        required: false,
    })
    size: number;
}
