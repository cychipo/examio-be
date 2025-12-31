import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty } from '@nestjs/swagger';

export const UpdateQuizSetDtoSchema = z.object({
    title: z.string().min(1, { message: 'Title must not be empty' }).optional(),
    description: z.string().optional(),
    // Handle both boolean and string from FormData
    isPublic: z
        .union([z.boolean(), z.string()])
        .transform((val) => (typeof val === 'string' ? val === 'true' : val))
        .optional(),
    isPinned: z
        .union([z.boolean(), z.string()])
        .transform((val) => (typeof val === 'string' ? val === 'true' : val))
        .optional(),
    // Handle both array and JSON string from FormData
    tags: z
        .union([z.array(z.string()), z.string()])
        .transform((val) => (typeof val === 'string' ? JSON.parse(val) : val))
        .optional(),
    // Handle both URL string and empty string (when uploading file)
    thumbnail: z.string().optional(),
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
