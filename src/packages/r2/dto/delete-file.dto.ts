import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty } from '@nestjs/swagger';

export const DeleteFileSchema = z.object({
    key: z.string().min(1, { message: 'Key is required' }),
});

export class DeleteFileDto extends createZodDto(DeleteFileSchema) {
    @ApiProperty({
        description: 'Key/path của file cần xóa',
        example: 'avatars/user123.jpg',
    })
    key: string;
}

export class DeleteFileResponseDto {
    @ApiProperty({
        description: 'Success message',
        example: 'File deleted successfully',
    })
    message: string;
}

export class DeleteDirectoryDto {
    @ApiProperty({
        description: 'Thư mục cần xóa',
        example: 'avatars',
    })
    directory: string;
}

export class DeleteDirectoryResponseDto {
    @ApiProperty({
        description: 'Success message',
        example: 'Directory deleted successfully',
    })
    message: string;

    @ApiProperty({
        description: 'Số lượng files đã xóa',
        example: 10,
    })
    deletedCount: number;
}
