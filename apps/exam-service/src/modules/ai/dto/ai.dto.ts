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
    // FE sends typeResult: 1 = quiz, 2 = flashcard
    typeResult: z.number().optional(),
    quantityQuizz: z.number().optional(),
    quantityFlashcard: z.number().optional(),
    isNarrowSearch: z.boolean().optional(),
    keyword: z.string().optional(),
    modelType: z.string().optional(), // model id tu registry
    // Legacy fields for backward compatibility
    outputType: z.enum(['quiz', 'flashcard']).optional(),
    count: z.number().optional(),
});

export class RegenerateDto extends createZodDto(RegenerateSchema) {
    @ApiProperty({
        description: 'Loại output: 1 = quiz, 2 = flashcard',
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
        description: 'Model AI id tu registry',
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
export const GenerateFromFileSchema = z.object({
    typeResult: z.string(),
    quantityQuizz: z.string().optional(),
    quantityFlashcard: z.string().optional(),
    isNarrowSearch: z.string().optional(), // Form data sends boolean as string 'true'/'false'
    keyword: z.string().optional(),
    modelType: z.string().optional(),
});

export class GenerateFromFileDto extends createZodDto(GenerateFromFileSchema) {
    @ApiProperty({ description: 'Loại output: 0 = flashcard, 1 = quiz' })
    typeResult: string;

    @ApiProperty({ description: 'Số câu hỏi quiz', required: false })
    quantityQuizz?: string;

    @ApiProperty({ description: 'Số flashcard', required: false })
    quantityFlashcard?: string;

    @ApiProperty({
        description: 'Tìm kiếm hẹp (true/false string)',
        required: false,
    })
    isNarrowSearch?: string;

    @ApiProperty({ description: 'Từ khóa tìm kiếm', required: false })
    keyword?: string;

    @ApiProperty({
        description: 'Model AI id tu registry',
        required: false,
    })
    modelType?: string;
}

export const TutorMessageSchema = z.object({
    role: z.string(),
    content: z.string(),
});

export const TutorIngestSchema = z.object({
    sourcePath: z.string(),
    courseCode: z.string(),
    language: z.string().optional(),
    topic: z.string().optional(),
    difficulty: z.enum(['basic', 'intermediate', 'advanced']).optional(),
    reindexMode: z
        .enum(['incremental', 'full', 'graph-only', 'embedding-only'])
        .optional(),
    licenseTag: z.string().optional(),
    dryRun: z.boolean().optional(),
    triggeredBy: z.string().optional(),
});

export class TutorIngestDto extends createZodDto(TutorIngestSchema) {
    @ApiProperty({ description: 'Đường dẫn nguồn dữ liệu' })
    sourcePath: string;

    @ApiProperty({ description: 'Mã học phần' })
    courseCode: string;

    @ApiProperty({ description: 'Ngôn ngữ', required: false })
    language?: string;

    @ApiProperty({ description: 'Chủ đề', required: false })
    topic?: string;

    @ApiProperty({ required: false, enum: ['basic', 'intermediate', 'advanced'] })
    difficulty?: 'basic' | 'intermediate' | 'advanced';

    @ApiProperty({
        required: false,
        enum: ['incremental', 'full', 'graph-only', 'embedding-only'],
    })
    reindexMode?: 'incremental' | 'full' | 'graph-only' | 'embedding-only';

    @ApiProperty({ required: false })
    licenseTag?: string;

    @ApiProperty({ required: false })
    dryRun?: boolean;

    @ApiProperty({ required: false })
    triggeredBy?: string;
}

export const TutorQuerySchema = z.object({
    query: z.string(),
    history: z.array(TutorMessageSchema).optional(),
    courseCode: z.string().optional(),
    language: z.string().optional(),
    topic: z.string().optional(),
    difficulty: z.enum(['basic', 'intermediate', 'advanced']).optional(),
    topK: z.number().int().min(1).max(10).optional(),
    modelType: z.string().optional(),
});

export class TutorQueryDto extends createZodDto(TutorQuerySchema) {
    @ApiProperty({ description: 'Câu hỏi của người dùng' })
    query: string;

    @ApiProperty({ required: false, type: [Object] })
    history?: Array<{ role: string; content: string }>;

    @ApiProperty({ description: 'Mã học phần', required: false })
    courseCode?: string;

    @ApiProperty({ required: false })
    language?: string;

    @ApiProperty({ required: false })
    topic?: string;

    @ApiProperty({ required: false, enum: ['basic', 'intermediate', 'advanced'] })
    difficulty?: 'basic' | 'intermediate' | 'advanced';

    @ApiProperty({ required: false, minimum: 1, maximum: 10 })
    topK?: number;

    @ApiProperty({ required: false })
    modelType?: string;
}

export const TutorKnowledgeUploadSchema = z.object({
    folderId: z.string().optional(),
    folderName: z.string().optional(),
    folderDescription: z.string().optional(),
    description: z.string().optional(),
    courseCode: z.string().optional(),
    language: z.string().optional(),
    topic: z.string().optional(),
    difficulty: z.enum(['basic', 'intermediate', 'advanced']).optional(),
});

export class TutorKnowledgeUploadDto extends createZodDto(TutorKnowledgeUploadSchema) {
    @ApiProperty({ required: false })
    folderId?: string;

    @ApiProperty({ required: false })
    folderName?: string;

    @ApiProperty({ required: false })
    folderDescription?: string;

    @ApiProperty({ required: false })
    description?: string;

    @ApiProperty({ required: false })
    courseCode?: string;

    @ApiProperty({ required: false })
    language?: string;

    @ApiProperty({ required: false })
    topic?: string;

    @ApiProperty({ required: false, enum: ['basic', 'intermediate', 'advanced'] })
    difficulty?: 'basic' | 'intermediate' | 'advanced';
}

export const TutorKnowledgeFolderSchema = z.object({
    folderId: z.string().optional(),
    name: z.string(),
    description: z.string().optional(),
    icon: z.string(),
});

export class TutorKnowledgeFolderDto extends createZodDto(TutorKnowledgeFolderSchema) {
    @ApiProperty({ required: false })
    folderId?: string;

    @ApiProperty()
    name: string;

    @ApiProperty({ required: false })
    description?: string;

    @ApiProperty()
    icon: string;
}
