import { User } from '@prisma/client';

export function sanitizeUser(
    user: User & {
        wallet?: {
            id?: string;
            userId?: string;
            balance: number;
            createdAt?: Date;
            updatedAt?: Date;
        } | null;
    }
): Omit<User, 'password' | 'isAdmin'> {
    const { password, isAdmin, ...rest } = user;
    return rest;
}
