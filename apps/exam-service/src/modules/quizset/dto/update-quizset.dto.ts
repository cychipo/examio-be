import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty } from '@nestjs/swagger';

export const UpdateQuizSetDtoSchema = z.object({
    title: z.string().min(1, { message: 'Title must not be empty' }).optional(),
    description: z.string().optional(),
    isPublic: z.boolean().optional(),
    tags: z.array(z.string()).optional(),
    thumbnail: z.string().url().optional(),
});

export class UpdateQuizSetDto extends createZodDto(UpdateQuizSetDtoSchema) {
    @ApiProperty({
        description: 'Title of the quiz set',
        example: 'Basic Math Quiz',
        required: false,
    })
    title?: string;

    @ApiProperty({
        description: 'Description of the quiz set',
        example: 'A quiz set covering basic math concepts.',
        required: false,
    })
    description?: string;

    @ApiProperty({
        description: 'Indicates if the quiz set is public',
        example: false,
        required: false,
    })
    isPublic?: boolean;

    @ApiProperty({
        description: 'Tags associated with the quiz set',
        example: ['math', 'algebra'],
        required: false,
        type: [String],
    })
    tags?: string[];

    @ApiProperty({
        description: 'URL of the thumbnail image for the quiz set',
        example: 'https://example.com/thumbnail.jpg',
        required: false,
    })
    thumbnail?: string;
}
