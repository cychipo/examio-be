import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty } from '@nestjs/swagger';

export const CreateFlashcardsetSchema = z.object({
    title: z.string().min(1, { message: 'Title must not be empty' }),
    description: z.string().optional(),
    isPublic: z.boolean().optional().default(false),
    isPinned: z.boolean().optional().default(false),
    tags: z.array(z.string()).optional().default([]),
    thumbnail: z.string().url().optional(),
});

export class CreateFlashcardsetDto extends createZodDto(
    CreateFlashcardsetSchema
) {
    @ApiProperty({
        description: 'Title of the flashcard set',
        example: 'Basic Vocabulary',
    })
    title: string;

    @ApiProperty({
        description: 'Description of the flashcard set',
        example: 'A flashcard set covering basic vocabulary.',
        required: false,
    })
    description?: string;

    @ApiProperty({
        description: 'Indicates if the flashcard set is public',
        example: false,
        required: false,
    })
    isPublic?: boolean;

    @ApiProperty({
        description: 'Indicates if the flashcard set is pinned',
        example: false,
        required: false,
    })
    isPinned?: boolean;

    @ApiProperty({
        description: 'Tags associated with the flashcard set',
        example: ['english', 'vocabulary'],
        required: false,
        type: [String],
    })
    tags?: string[];

    @ApiProperty({
        description: 'URL of the thumbnail image for the flashcard set',
        example: 'https://example.com/thumbnail.jpg',
        required: false,
    })
    thumbnail?: string;
}
