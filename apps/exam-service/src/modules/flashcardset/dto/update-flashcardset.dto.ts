import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty } from '@nestjs/swagger';

export const UpdateFlashcardSetDtoSchema = z.object({
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

export class UpdateFlashcardSetDto extends createZodDto(
    UpdateFlashcardSetDtoSchema
) {
    @ApiProperty({
        description: 'Title of the flashcard set',
        example: 'Basic Vocabulary',
        required: false,
    })
    title?: string;

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
