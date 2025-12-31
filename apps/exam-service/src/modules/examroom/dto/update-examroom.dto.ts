import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty } from '@nestjs/swagger';

export const UpdateExamRoomDtoSchema = z.object({
    title: z.string().min(1, { message: 'Title must not be empty' }).optional(),
    description: z.string().optional(),
    quizSetId: z.string().optional(),
});

export class UpdateExamRoomDto extends createZodDto(UpdateExamRoomDtoSchema) {
    @ApiProperty({
        description: 'Title of the exam room',
        example: 'Midterm Exam - Mathematics',
        required: false,
    })
    title?: string;

    @ApiProperty({
        description: 'Description of the exam room',
        example: 'This is a midterm exam for mathematics course.',
        required: false,
    })
    description?: string;

    @ApiProperty({
        description: 'ID of the quiz set for this exam',
        example: 'quiz_123456',
        required: false,
    })
    quizSetId?: string;
}
