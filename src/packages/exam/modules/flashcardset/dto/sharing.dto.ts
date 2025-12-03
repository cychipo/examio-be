import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty } from '@nestjs/swagger';

// DTO for updating sharing settings
export const UpdateSharingSettingsSchema = z.object({
    isPublic: z.boolean(),
    accessCode: z.string().length(6).optional().nullable(),
    whitelist: z.array(z.string()).optional().default([]),
});

export class UpdateSharingSettingsDto extends createZodDto(
    UpdateSharingSettingsSchema
) {
    @ApiProperty({
        description: 'Indicates if the flashcard set is public',
        example: true,
    })
    isPublic: boolean;

    @ApiProperty({
        description: '6-digit access code for private access',
        example: '123456',
        required: false,
    })
    accessCode?: string | null;

    @ApiProperty({
        description: 'List of user IDs who can access',
        example: ['user1', 'user2'],
        required: false,
        type: [String],
    })
    whitelist?: string[];
}

// DTO for verifying access code
export const VerifyAccessCodeSchema = z.object({
    accessCode: z.string().length(6),
});

export class VerifyAccessCodeDto extends createZodDto(VerifyAccessCodeSchema) {
    @ApiProperty({
        description: '6-digit access code to verify',
        example: '123456',
    })
    accessCode: string;
}

// Response DTOs
export class SharingSettingsResponseDto {
    @ApiProperty({ example: 'Cập nhật cài đặt chia sẻ thành công' })
    message: string;

    @ApiProperty({ example: true })
    isPublic: boolean;

    @ApiProperty({ example: '123456', required: false })
    accessCode?: string | null;

    @ApiProperty({ example: ['user1', 'user2'] })
    whitelist: string[];
}

export class AccessCheckResponseDto {
    @ApiProperty({ example: true })
    hasAccess: boolean;

    @ApiProperty({ example: 'public' })
    accessType: 'public' | 'owner' | 'whitelist' | 'code_required' | 'denied';

    @ApiProperty({ example: true, required: false })
    requiresCode?: boolean;
}

export class VerifyCodeResponseDto {
    @ApiProperty({ example: true })
    valid: boolean;

    @ApiProperty({ example: 'Mã xác thực hợp lệ' })
    message: string;
}

export class FlashcardSetPublicInfoDto {
    @ApiProperty({ example: 'abc123' })
    id: string;

    @ApiProperty({ example: 'Bộ thẻ tiếng Anh' })
    title: string;

    @ApiProperty({ example: 'Bộ thẻ cơ bản' })
    description?: string;

    @ApiProperty({ example: 'https://example.com/thumb.jpg' })
    thumbnail?: string;

    @ApiProperty({ example: 100 })
    viewCount: number;

    @ApiProperty({ example: 50 })
    cardCount: number;

    @ApiProperty({
        example: {
            id: 'user123',
            username: 'john_doe',
            name: 'John Doe',
            avatar: 'https://example.com/avatar.jpg',
        },
    })
    creator: {
        id: string;
        username: string;
        name: string | null;
        avatar: string | null;
    };

    @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
    createdAt: string;
}
