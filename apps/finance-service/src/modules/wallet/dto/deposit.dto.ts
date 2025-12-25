import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty } from '@nestjs/swagger';

export const DepositSchema = z.object({
    amount: z.number().min(0.01, { message: 'Amount must be at least 0.01' }),
});

export class DepositDto extends createZodDto(DepositSchema) {
    @ApiProperty({
        description: 'Amount to deposit into the wallet',
        example: 50.0,
        minimum: 0.01,
    })
    amount: number;
}
