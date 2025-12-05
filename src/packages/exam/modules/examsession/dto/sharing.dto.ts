import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty } from '@nestjs/swagger';

// ================== UPDATE SHARING SETTINGS ==================

export const UpdateSharingSettingsSchema = z.object({
    isPublic: z.boolean(),
    accessCode: z.string().length(6).optional().nullable(),
    whitelist: z.array(z.string()).optional().default([]),
});

export class UpdateSharingSettingsDto extends createZodDto(
    UpdateSharingSettingsSchema
) {
    @ApiProperty({
        description: 'Whether the exam session is public',
        example: true,
    })
    isPublic: boolean;

    @ApiProperty({
        description: '6-digit access code for private sessions',
        example: '123456',
        required: false,
    })
    accessCode?: string | null;

    @ApiProperty({
        description: 'List of user IDs who can access this session',
        example: ['user_123', 'user_456'],
        required: false,
    })
    whitelist?: string[];
}

// ================== VERIFY ACCESS CODE ==================

export const VerifyAccessCodeSchema = z.object({
    accessCode: z.string().length(6),
});

export class VerifyAccessCodeDto extends createZodDto(VerifyAccessCodeSchema) {
    @ApiProperty({
        description: '6-digit access code',
        example: '123456',
    })
    accessCode: string;
}

// ================== RESPONSE DTOS ==================

export class AccessCheckResponseDto {
    @ApiProperty({
        description: 'Whether user has access',
        example: true,
    })
    hasAccess: boolean;

    @ApiProperty({
        description:
            'Type of access: public, owner, whitelist, code_required, denied',
        example: 'public',
    })
    accessType: 'public' | 'owner' | 'whitelist' | 'code_required' | 'denied';

    @ApiProperty({
        description: 'Whether a code is required for access',
        example: false,
        required: false,
    })
    requiresCode?: boolean;
}

export class VerifyCodeResponseDto {
    @ApiProperty({
        description: 'Whether the code is valid',
        example: true,
    })
    valid: boolean;

    @ApiProperty({
        description: 'Response message',
        example: 'Mã xác thực hợp lệ',
    })
    message: string;
}

export class SharingSettingsResponseDto {
    @ApiProperty({
        description: 'Success message',
        example: 'Cập nhật cài đặt chia sẻ thành công',
    })
    message: string;

    @ApiProperty({
        description: 'Whether the session is public',
        example: true,
    })
    isPublic: boolean;

    @ApiProperty({
        description: 'Access code if set',
        example: '123456',
        required: false,
    })
    accessCode?: string | null;

    @ApiProperty({
        description: 'Whitelist of user IDs',
        example: ['user_123'],
        required: false,
    })
    whitelist?: string[];
}

export class ExamSessionPublicInfoDto {
    @ApiProperty({ example: 'session_123' })
    id: string;

    @ApiProperty({ example: 'Midterm Exam' })
    title: string;

    @ApiProperty({ example: 'Mathematics midterm exam', required: false })
    description?: string;

    @ApiProperty({ example: '2025-10-15T10:00:00Z' })
    startTime: string;

    @ApiProperty({ example: '2025-10-15T12:00:00Z', required: false })
    endTime?: string;

    @ApiProperty({ example: 0 })
    status: number;

    @ApiProperty({ example: true })
    isPublic: boolean;

    @ApiProperty({ example: false })
    requiresCode: boolean;

    @ApiProperty()
    creator: {
        id: string;
        username: string;
        name: string | null;
        avatar: string | null;
    };

    @ApiProperty()
    examRoom: {
        id: string;
        title: string;
        description: string | null;
    };
}
