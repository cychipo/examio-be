import {
    Controller,
    Post,
    Get,
    Body,
    Req,
    Res,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { ProxyService } from '../services/proxy.service';

// DTOs for Swagger documentation
class LoginDto {
    credential: string;
    password: string;
}

class RegisterDto {
    username: string;
    email: string;
    password: string;
}

@ApiTags('Auth')
@Controller('auth')
export class AuthProxyController {
    constructor(private readonly proxyService: ProxyService) {}

    @Post('login')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Đăng nhập' })
    @ApiBody({ type: LoginDto })
    @ApiResponse({ status: 200, description: 'Đăng nhập thành công' })
    @ApiResponse({ status: 401, description: 'Sai thông tin đăng nhập' })
    async login(@Body() body: any, @Req() req: Request, @Res() res: Response) {
        const result = await this.proxyService.forward('auth', {
            method: 'POST',
            path: '/api/v1/auth/login',
            body,
            headers: this.extractHeaders(req),
        });

        // Forward cookies from auth service
        if (result.accessToken) {
            res.cookie('accessToken', result.accessToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
            });
        }

        return res.json(result);
    }

    @Post('register')
    @ApiOperation({ summary: 'Đăng ký tài khoản mới' })
    @ApiBody({ type: RegisterDto })
    @ApiResponse({ status: 201, description: 'Đăng ký thành công' })
    @ApiResponse({ status: 409, description: 'Email/Username đã tồn tại' })
    async register(@Body() body: any, @Req() req: Request) {
        return this.proxyService.forward('auth', {
            method: 'POST',
            path: '/api/v1/auth/register',
            body,
            headers: this.extractHeaders(req),
        });
    }

    @Post('logout')
    @ApiOperation({ summary: 'Đăng xuất' })
    @ApiResponse({ status: 200, description: 'Đăng xuất thành công' })
    async logout(@Req() req: Request, @Res() res: Response) {
        const token = this.extractToken(req);
        const result = await this.proxyService.forwardWithAuth(
            'auth',
            {
                method: 'POST',
                path: '/api/v1/auth/logout',
                headers: this.extractHeaders(req),
            },
            token
        );

        res.clearCookie('accessToken');
        return res.json(result);
    }

    @Get('me')
    @ApiOperation({ summary: 'Lấy thông tin user hiện tại' })
    @ApiResponse({ status: 200, description: 'User info' })
    @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
    async getMe(@Req() req: Request) {
        const token = this.extractToken(req);
        return this.proxyService.forwardWithAuth(
            'auth',
            {
                method: 'GET',
                path: '/api/v1/auth/me',
                headers: this.extractHeaders(req),
            },
            token
        );
    }

    @Get('google')
    @ApiOperation({ summary: 'Đăng nhập bằng Google' })
    async googleAuth(@Res() res: Response) {
        const authUrl = `${process.env.AUTH_SERVICE_URL || 'http://localhost:3001'}/api/v1/auth/google`;
        return res.redirect(authUrl);
    }

    private extractHeaders(req: Request): Record<string, string> {
        return {
            'user-agent': req.headers['user-agent'] || '',
            'x-forwarded-for':
                (req.headers['x-forwarded-for'] as string) ||
                req.socket.remoteAddress ||
                '',
        };
    }

    private extractToken(req: Request): string {
        const authHeader = req.headers.authorization;
        if (authHeader?.startsWith('Bearer ')) {
            return authHeader.substring(7);
        }
        return req.cookies?.accessToken || '';
    }
}
