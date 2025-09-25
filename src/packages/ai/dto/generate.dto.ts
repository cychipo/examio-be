import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty } from '@nestjs/swagger';

export const GenerateSchema = z.object({
    prompt: z.string().min(1, { message: 'Prompt must not be empty' }),
});

export class GenerateDto extends createZodDto(GenerateSchema) {
    @ApiProperty({
        description: 'Prompt text to generate content',
        example: 'Write a short story about a robot learning to love.',
    })
    prompt: string;
}
