import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty } from '@nestjs/swagger';

export const CreateParticipantSchema = z.object({
    examSessionId: z
        .string()
        .min(1, { message: 'Exam session ID is required' }),
});

export class CreateParticipantDto extends createZodDto(
    CreateParticipantSchema
) {
    @ApiProperty({
        description: 'ID of the exam session to join',
        example: 'examsession_123456',
    })
    examSessionId: string;
}
