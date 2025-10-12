import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty } from '@nestjs/swagger';

export const GetFlashcardsetsSchema = z.object({
    page: z.number().min(1).default(1),
    limit: z.number().min(1).max(100).default(10),
    search: z.string().optional(),
    tag: z.array(z.string()).optional(),
    isPublic: z.boolean().optional(),
    isPinned: z.boolean().optional(),
});

export class GetFlashcardsetsDto extends createZodDto(GetFlashcardsetsSchema) {
    @ApiProperty({
        description: 'Page number for pagination',
        example: 1,
        required: false,
    })
    page: number;

    @ApiProperty({
        description: 'Number of items per page for pagination',
        example: 10,
        required: false,
    })
    limit: number;

    @ApiProperty({
        description:
            'Search term to filter flashcard sets by title or description',
        example: 'vocabulary',
        required: false,
    })
    search?: string;

    @ApiProperty({
        description: 'Tags to filter flashcard sets',
        example: ['english', 'vocabulary'],
        required: false,
        type: [String],
    })
    tag?: string[];

    @ApiProperty({
        description: 'Filter for public flashcard sets',
        example: true,
        required: false,
    })
    isPublic?: boolean;

    @ApiProperty({
        description: 'Filter for pinned flashcard sets',
        example: false,
        required: false,
    })
    isPinned?: boolean;
}
