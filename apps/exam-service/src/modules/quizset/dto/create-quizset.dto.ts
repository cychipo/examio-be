import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty } from '@nestjs/swagger';

export const CreateQuizsetSchema = z.object({
    title: z.string().min(1, { message: 'Title must not be empty' }),
    description: z.string().optional(),
    isPublic: z.boolean().optional().default(false),
    isPinned: z.boolean().optional().default(false),
    tags: z.array(z.string()).optional().default([]),
    thumbnail: z.string().url().optional(),
});

export class CreateQuizsetDto extends createZodDto(CreateQuizsetSchema) {
    @ApiProperty({
        description: 'Title of the quiz set',
        example: 'Basic Math Quiz',
    })
    title: string;

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
        description: 'Indicates if the quiz set is pinned',
        example: false,
        required: false,
    })
    isPinned?: boolean;

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
