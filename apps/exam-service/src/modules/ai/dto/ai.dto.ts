import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty } from '@nestjs/swagger';

export const UploadFileSchema = z.object({
    filename: z.string(),
    url: z.string(),
    mimetype: z.string(),
    size: z.number(),
    keyR2: z.string(),
});

export class UploadFileDto extends createZodDto(UploadFileSchema) {
    @ApiProperty({ description: 'Tên file' })
    filename: string;

    @ApiProperty({ description: 'URL file trên R2' })
    url: string;

    @ApiProperty({ description: 'MIME type của file' })
    mimetype: string;

    @ApiProperty({ description: 'Kích thước file (bytes)' })
    size: number;

    @ApiProperty({ description: 'Key R2 của file' })
    keyR2: string;
}

export const RegenerateSchema = z.object({
    // FE sends typeResult: 0 = flashcard, 1 = quiz
    typeResult: z.number().optional(),
    quantityQuizz: z.number().optional(),
    quantityFlashcard: z.number().optional(),
    isNarrowSearch: z.boolean().optional(),
    keyword: z.string().optional(),
    modelType: z.string().optional(), // 'gemini' or 'fayedark'
    // Legacy fields for backward compatibility
    outputType: z.enum(['quiz', 'flashcard']).optional(),
    count: z.number().optional(),
});

export class RegenerateDto extends createZodDto(RegenerateSchema) {
    @ApiProperty({
        description: 'Loại output: 0 = flashcard, 1 = quiz',
        required: false,
    })
    typeResult?: number;

    @ApiProperty({ description: 'Số câu hỏi quiz', required: false })
    quantityQuizz?: number;

    @ApiProperty({ description: 'Số flashcard', required: false })
    quantityFlashcard?: number;

    @ApiProperty({ description: 'Tìm kiếm hẹp', required: false })
    isNarrowSearch?: boolean;

    @ApiProperty({ description: 'Từ khóa tìm kiếm', required: false })
    keyword?: string;

    @ApiProperty({
        description: 'Model AI: gemini hoặc fayedark',
        required: false,
    })
    modelType?: string;

    @ApiProperty({
        description: 'Loại output (legacy)',
        enum: ['quiz', 'flashcard'],
        required: false,
    })
    outputType?: 'quiz' | 'flashcard';

    @ApiProperty({
        description: 'Số lượng items cần tạo (legacy)',
        required: false,
    })
    count?: number;
}

export const UploadImageSchema = z.object({
    image: z.string(),
    filename: z.string().optional(),
});

export class UploadImageDto extends createZodDto(UploadImageSchema) {
    @ApiProperty({ description: 'Base64 encoded image hoặc URL' })
    image: string;

    @ApiProperty({ description: 'Tên file', required: false })
    filename?: string;
}

// DTO for generate-from-file endpoint (multipart form data)
export class GenerateFromFileDto {
    @ApiProperty({ description: 'Loại output: 0 = flashcard, 1 = quiz' })
    typeResult: string; // Comes as string from form-data

    @ApiProperty({ description: 'Số câu hỏi quiz', required: false })
    quantityQuizz?: string;

    @ApiProperty({ description: 'Số flashcard', required: false })
    quantityFlashcard?: string;

    @ApiProperty({ description: 'Tìm kiếm hẹp', required: false })
    isNarrowSearch?: string;

    @ApiProperty({ description: 'Từ khóa tìm kiếm', required: false })
    keyword?: string;

    @ApiProperty({
        description: 'Model AI: gemini hoặc fayedark',
        required: false,
    })
    modelType?: string;
}
