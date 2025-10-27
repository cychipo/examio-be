import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty } from '@nestjs/swagger';

export const ListFilesSchema = z.object({
    directory: z.string().optional(),
    maxKeys: z.number().optional().default(1000),
});

export class ListFilesDto extends createZodDto(ListFilesSchema) {
    @ApiProperty({
        description: 'Thư mục/prefix để list files',
        example: 'avatars',
        required: false,
    })
    directory?: string;

    @ApiProperty({
        description: 'Số lượng files tối đa',
        example: 1000,
        required: false,
        default: 1000,
    })
    maxKeys?: number;
}

export class FileItemDto {
    @ApiProperty({
        description: 'Key/path của file',
        example: 'avatars/user123.jpg',
    })
    key: string;

    @ApiProperty({
        description: 'Kích thước file (bytes)',
        example: 102400,
    })
    size: number;

    @ApiProperty({
        description: 'Thời gian sửa đổi lần cuối',
        example: '2025-10-27T10:00:00.000Z',
    })
    lastModified: Date;

    @ApiProperty({
        description: 'Public URL của file',
        example: 'https://examio-r2.fayedark.com/avatars/user123.jpg',
    })
    url: string;
}

export class ListFilesResponseDto {
    @ApiProperty({
        description: 'Danh sách files',
        type: [FileItemDto],
    })
    files: FileItemDto[];

    @ApiProperty({
        description: 'Tổng số files',
        example: 10,
    })
    total: number;
}
