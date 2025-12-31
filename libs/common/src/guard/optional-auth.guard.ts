import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { PrismaService } from '@examio/database';
import * as cookie from 'cookie';

/**
 * OptionalAuthGuard - Similar to AuthGuard but doesn't throw error if no token
 * Sets user to undefined if not authenticated
 */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
    constructor(
        private readonly jwtService: JwtService,
        private readonly prisma: PrismaService
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request: Request = context.switchToHttp().getRequest();
        const token = this.extractTokenFromRequest(request);

        if (!token) {
            request['user'] = undefined;
            return true;
        }

        try {
            const decoded = await this.jwtService.verifyAsync(token, {
                secret: process.env.JWT_SECRET,
            });

            const user = await this.prisma.user.findUnique({
                where: { id: decoded.userId },
                select: {
                    id: true,
                    username: true,
                    email: true,
                    isAdmin: true,
                    isVerified: true,
                    createdAt: true,
                    updatedAt: true,
                },
            });

            request['user'] = user || undefined;
            return true;
        } catch {
            request['user'] = undefined;
            return true;
        }
    }

    private extractTokenFromRequest(request: Request): string | undefined {
        // 1. Check Cookie first
        const cookieHeader = request.headers.cookie;
        if (cookieHeader) {
            const cookies = cookie.parse(cookieHeader);
            if (cookies.token) {
                return cookies.token;
            }
        }

        // 2. Fallback: Authorization header
        const authHeader = request.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            return authHeader.substring(7);
        }

        return undefined;
    }
}
