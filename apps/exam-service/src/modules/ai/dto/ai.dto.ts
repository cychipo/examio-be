import { IsString, IsOptional, IsNumber } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UploadFileDto {
    @ApiProperty({ description: 'Tên file' })
    @IsString()
    filename: string;

    @ApiProperty({ description: 'URL file trên R2' })
    @IsString()
    url: string;

    @ApiProperty({ description: 'MIME type của file' })
    @IsString()
    mimetype: string;

    @ApiProperty({ description: 'Kích thước file (bytes)' })
    @IsNumber()
    size: number;

    @ApiProperty({ description: 'Key R2 của file' })
    @IsString()
    keyR2: string;
}

export class RegenerateDto {
    @ApiProperty({ description: 'Loại output', enum: ['quiz', 'flashcard'] })
    @IsString()
    @IsOptional()
    outputType?: 'quiz' | 'flashcard';

    @ApiProperty({ description: 'Số lượng items cần tạo', required: false })
    @IsNumber()
    @IsOptional()
    count?: number;
}

export class UploadImageDto {
    @ApiProperty({ description: 'Base64 encoded image hoặc URL' })
    @IsString()
    image: string;

    @ApiProperty({ description: 'Tên file', required: false })
    @IsString()
    @IsOptional()
    filename?: string;
}
