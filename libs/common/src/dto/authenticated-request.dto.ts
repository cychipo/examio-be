import { Request } from 'express';
import { User } from '@prisma/client';

/**
 * Request object with authenticated user
 * Dùng trong các controller khi có @UseGuards(AuthGuard)
 */
export interface AuthenticatedRequest extends Request {
    user: User;
}

/**
 * Request object for OAuth callbacks
 */
export interface AuthenticatedOauthRequest extends Request {
    user: {
        token: string;
        user: User;
    };
}
