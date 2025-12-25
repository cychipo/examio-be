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
        subscription?: {
            id: string;
            userId: string;
            tier: number;
            billingCycle: string;
            lastPaymentDate?: Date | null;
            nextPaymentDate?: Date | null;
            isActive: boolean;
            createdAt: Date;
            updatedAt: Date;
        } | null;
    }
): Omit<User, 'password' | 'isAdmin'> & {
    wallet?: { balance: number } | null;
    subscription?: {
        id: string;
        tier: number;
        billingCycle: string;
        isActive: boolean;
        lastPaymentDate?: Date | null;
        nextPaymentDate?: Date | null;
    } | null;
} {
    const { password, isAdmin, ...rest } = user;
    return rest;
}
