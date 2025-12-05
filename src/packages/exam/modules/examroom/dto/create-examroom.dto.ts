import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty } from '@nestjs/swagger';

export const CreateExamRoomSchema = z.object({
    title: z.string().min(1, { message: 'Title must not be empty' }),
    description: z.string().optional(),
    quizSetId: z.string().min(1, { message: 'Quiz set ID is required' }),
});

export class CreateExamRoomDto extends createZodDto(CreateExamRoomSchema) {
    @ApiProperty({
        description: 'Title of the exam room',
        example: 'Midterm Exam - Mathematics',
    })
    title: string;

    @ApiProperty({
        description: 'Description of the exam room',
        example: 'This is a midterm exam for mathematics course.',
        required: false,
    })
    description?: string;

    @ApiProperty({
        description: 'ID of the quiz set for this exam',
        example: 'quiz_123456',
    })
    quizSetId: string;
}
