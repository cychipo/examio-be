import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { ApiProperty } from '@nestjs/swagger';
import { User } from '@prisma/client';

export const LoginSchema = z.object({
    credential: z.string().min(1, { message: 'Credential must not be empty' }),
    password: z
        .string()
        .min(6, { message: 'Password must be at least 6 characters long' }),
});

export class LoginDto extends createZodDto(LoginSchema) {
    @ApiProperty({
        description: 'User credential (email or username)',
        example: 'jodn_123',
    })
    credential: string;
    @ApiProperty({
        description: 'User password',
        example: 'password123',
    })
    password: string;
}

export class LoginResponse {
    @ApiProperty({
        description: 'JWT token for authenticated user',
        example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    })
    token: string;

    @ApiProperty({
        description: 'Sanitized user object',
        type: Object,
    })
    user: Omit<User, 'password'>;
}
