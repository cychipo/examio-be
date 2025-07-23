import { User } from '@prisma/client';

export interface AuthenticatedRequest extends Request {
    user: User;
}

export interface AuthenticatedOauthRequest extends Request {
    user: {
        user: User;
        token?: string;
    }
}