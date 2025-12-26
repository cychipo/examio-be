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
    outputType: z.enum(['quiz', 'flashcard']).optional(),
    count: z.number().optional(),
});

export class RegenerateDto extends createZodDto(RegenerateSchema) {
    @ApiProperty({
        description: 'Loại output',
        enum: ['quiz', 'flashcard'],
        required: false,
    })
    outputType?: 'quiz' | 'flashcard';

    @ApiProperty({ description: 'Số lượng items cần tạo', required: false })
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
