import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty } from '@nestjs/swagger';

export const UploadFileSchema = z.object({
    directory: z.string().optional(),
});

export class UploadFileDto extends createZodDto(UploadFileSchema) {
    @ApiProperty({
        description: 'Thư mục để lưu file (optional)',
        example: 'avatars',
        required: false,
    })
    directory?: string;
}

export class UploadFileResponseDto {
    @ApiProperty({
        description: 'Public URL của file đã upload',
        example: 'https://examio-r2.fayedark.com/avatars/user123.jpg',
    })
    url: string;

    @ApiProperty({
        description: 'Key/path của file trong bucket',
        example: 'avatars/user123.jpg',
    })
    key: string;

    @ApiProperty({
        description: 'Success message',
        example: 'File uploaded successfully',
    })
    message: string;
}
