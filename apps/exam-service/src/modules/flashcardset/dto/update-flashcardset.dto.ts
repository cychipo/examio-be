import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty } from '@nestjs/swagger';

export const UpdateFlashcardSetDtoSchema = z.object({
    title: z.string().min(1, { message: 'Title must not be empty' }).optional(),
    description: z.string().optional(),
    isPublic: z.boolean().optional(),
    tag: z.array(z.string()).optional(),
    thumbnail: z.string().url().optional(),
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
        description: 'Tags associated with the flashcard set',
        example: ['english', 'vocabulary'],
        required: false,
        type: [String],
    })
    tag?: string[];

    @ApiProperty({
        description: 'URL of the thumbnail image for the flashcard set',
        example: 'https://example.com/thumbnail.jpg',
        required: false,
    })
    thumbnail?: string;
}
