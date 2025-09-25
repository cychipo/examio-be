import { User } from '@prisma/client';

export function sanitizeUser(user: User): Omit<User, 'password' | 'isAdmin'> {
    const { password, isAdmin, ...rest } = user;
    return rest;
}