import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty } from '@nestjs/swagger';
import { ASSESS_TYPE } from '../../../types';

export const CreateExamRoomSchema = z.object({
    title: z.string().min(1, { message: 'Title must not be empty' }),
    description: z.string().optional(),
    quizSetId: z.string().min(1, { message: 'Quiz set ID is required' }),
    assessType: z
        .nativeEnum(ASSESS_TYPE)
        .optional()
        .default(ASSESS_TYPE.PUBLIC),
    allowRetake: z.boolean().optional().default(false),
    maxAttempts: z.number().int().min(1).optional().default(1),
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

    @ApiProperty({
        description: 'Assessment type: PUBLIC (0) or PRIVATE (1)',
        example: ASSESS_TYPE.PUBLIC,
        enum: ASSESS_TYPE,
        required: false,
    })
    assessType?: ASSESS_TYPE;

    @ApiProperty({
        description: 'Whether participants can retake the exam',
        example: false,
        required: false,
    })
    allowRetake?: boolean;

    @ApiProperty({
        description: 'Maximum number of attempts allowed',
        example: 1,
        required: false,
    })
    maxAttempts?: number;
}
