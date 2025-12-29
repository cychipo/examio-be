import {
    Injectable,
    NestMiddleware,
    UnauthorizedException,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { PrismaService } from '@examio/database';
import * as cookie from 'cookie';

/**
 * SessionValidationMiddleware
 *
 * Middleware to validate that the user's session is still active
 * If session is invalidated (user logged out from another device), throw 401
 * This ensures users are immediately logged out when their session is deactivated
 */
@Injectable()
export class SessionValidationMiddleware implements NestMiddleware {
    constructor(private readonly prisma: PrismaService) {}

    async use(req: Request, res: Response, next: NextFunction) {
        // Skip validation for public endpoints
        const publicPaths = [
            '/auth/login',
            '/auth/register',
            '/auth/refresh',
            '/auth/google',
            '/auth/facebook',
            '/auth/github',
            '/auth/send-code-reset-password',
            '/auth/reset-password',
        ];

        if (publicPaths.some((path) => req.path.includes(path))) {
            return next();
        }

        // Extract refresh token from cookie
        const cookieHeader = req.headers.cookie;
        if (!cookieHeader) {
            return next(); // No cookie, let AuthGuard handle it
        }

        const cookies = cookie.parse(cookieHeader);
        const refreshToken = cookies.refreshToken;

        if (!refreshToken) {
            return next(); // No refresh token, let AuthGuard handle it
        }

        try {
            // Check if session is still active
            const session = await this.prisma.userSession.findUnique({
                where: { refreshToken },
                select: {
                    isActive: true,
                    expiresAt: true,
                },
            });

            if (!session) {
                // Session not found - token was deleted
                throw new UnauthorizedException({
                    statusCode: 401,
                    message: 'Session not found',
                    code: 'SESSION_INVALIDATED',
                });
            }

            if (!session.isActive) {
                // Session was deactivated (logged out from another device)
                throw new UnauthorizedException({
                    statusCode: 401,
                    message: 'Session has been invalidated. Please login again.',
                    code: 'SESSION_INVALIDATED',
                });
            }

            if (new Date() > session.expiresAt) {
                // Session expired
                throw new UnauthorizedException({
                    statusCode: 401,
                    message: 'Session expired. Please login again.',
                    code: 'SESSION_EXPIRED',
                });
            }

            // Session is valid, proceed
            next();
        } catch (error) {
            if (error instanceof UnauthorizedException) {
                throw error;
            }
            // Database error or other issues - log but don't block request
            console.error('[SessionValidationMiddleware] Error:', error);
            next();
        }
    }
}
