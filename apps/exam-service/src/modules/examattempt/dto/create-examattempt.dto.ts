import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty } from '@nestjs/swagger';

export const CreateExamAttemptSchema = z.object({
    examSessionId: z
        .string()
        .min(1, { message: 'Exam session ID is required' }),
});

export class CreateExamAttemptDto extends createZodDto(
    CreateExamAttemptSchema
) {
    @ApiProperty({
        description: 'ID of the exam session',
        example: 'examsession_123456',
    })
    examSessionId: string;
}
