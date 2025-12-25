import {
    CanActivate,
    ExecutionContext,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { PrismaService } from '@examio/database';
import * as cookie from 'cookie';

@Injectable()
export class AuthGuard implements CanActivate {
    constructor(
        private readonly jwtService: JwtService,
        private readonly prisma: PrismaService
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request: Request = context.switchToHttp().getRequest();
        const token = this.extractTokenFromRequest(request);

        if (!token) {
            throw new UnauthorizedException('Token is required');
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

            if (!user) {
                throw new UnauthorizedException('User not found');
            }

            request['user'] = user;
            return true;
        } catch (err) {
            throw new UnauthorizedException('Invalid or expired token');
        }
    }

    /**
     * Extract token từ request theo thứ tự ưu tiên:
     * 1. Cookie (ưu tiên cao nhất - secure với httpOnly)
     * 2. Authorization header (fallback cho localStorage)
     */
    private extractTokenFromRequest(request: Request): string | undefined {
        // 1. Ưu tiên: Check Cookie trước
        const cookieHeader = request.headers.cookie;
        if (cookieHeader) {
            const cookies = cookie.parse(cookieHeader);
            if (cookies.token) {
                return cookies.token;
            }
        }

        // 2. Fallback: Authorization header (cho localStorage)
        const authHeader = request.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            return authHeader.substring(7);
        }

        return undefined;
    }
}
