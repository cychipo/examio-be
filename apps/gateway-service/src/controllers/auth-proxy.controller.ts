import {
    Controller,
    Get,
    Post,
    Put,
    Patch,
    Delete,
    Param,
    Body,
    Query,
    Req,
    Res,
    UseInterceptors,
    UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
    ApiTags,
    ApiOperation,
    ApiResponse,
    ApiBearerAuth,
    ApiQuery,
    ApiConsumes,
    ApiBody,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { ProxyService } from '../services/proxy.service';

@ApiTags('Auth')
@Controller('auth')
export class AuthProxyController {
    constructor(private readonly proxyService: ProxyService) {}

    // ==================== PUBLIC ENDPOINTS ====================

    @Post('login')
    @ApiOperation({ summary: 'Đăng nhập' })
    @ApiResponse({ status: 200, description: 'Đăng nhập thành công' })
    async login(@Body() body: any, @Req() req: Request, @Res() res: Response) {
        const result = await this.proxyService.forward('auth', {
            method: 'POST',
            path: '/api/v1/auth/login',
            body,
            headers: this.extractHeaders(req),
        });
        if (result.token) {
            res.cookie('accessToken', result.token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                maxAge: 30 * 24 * 60 * 60 * 1000,
            });
        }
        return res.json(result);
    }

    @Post('register')
    @ApiOperation({ summary: 'Đăng ký tài khoản mới' })
    @ApiResponse({ status: 201, description: 'Đăng ký thành công' })
    async register(@Body() body: any, @Req() req: Request) {
        return this.proxyService.forward('auth', {
            method: 'POST',
            path: '/api/v1/auth/register',
            body,
            headers: this.extractHeaders(req),
        });
    }

    @Post('send-code-reset-password')
    @ApiOperation({ summary: 'Gửi mã reset password' })
    async sendCodeResetPassword(@Body() body: any, @Req() req: Request) {
        return this.proxyService.forward('auth', {
            method: 'POST',
            path: '/api/v1/auth/send-code-reset-password',
            body,
            headers: this.extractHeaders(req),
        });
    }

    @Post('reset-password')
    @ApiOperation({ summary: 'Reset password' })
    async resetPassword(@Body() body: any, @Req() req: Request) {
        return this.proxyService.forward('auth', {
            method: 'POST',
            path: '/api/v1/auth/reset-password',
            body,
            headers: this.extractHeaders(req),
        });
    }

    @Get('google')
    @ApiOperation({ summary: 'Đăng nhập bằng Google' })
    async googleAuth(@Res() res: Response) {
        const authUrl = `${process.env.AUTH_SERVICE_URL || 'http://localhost:3001'}/api/v1/auth/google`;
        return res.redirect(authUrl);
    }

    // ==================== AUTHENTICATED ENDPOINTS ====================

    @Get('me')
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'Lấy thông tin user hiện tại' })
    async getMe(@Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'auth',
            {
                method: 'GET',
                path: '/api/v1/auth/me',
                headers: this.extractHeaders(req),
            },
            this.extractToken(req)
        );
    }

    @Post('logout')
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'Đăng xuất' })
    async logout(@Req() req: Request, @Res() res: Response) {
        const result = await this.proxyService.forwardWithAuth(
            'auth',
            {
                method: 'POST',
                path: '/api/v1/auth/logout',
                headers: this.extractHeaders(req),
            },
            this.extractToken(req)
        );
        res.clearCookie('accessToken');
        return res.json(result);
    }

    @Post('sendVerificationEmail')
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'Gửi email xác thực' })
    async sendVerificationEmail(@Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'auth',
            {
                method: 'POST',
                path: '/api/v1/auth/sendVerificationEmail',
                headers: this.extractHeaders(req),
            },
            this.extractToken(req)
        );
    }

    @Post('verifyAccount')
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'Xác thực tài khoản' })
    async verifyAccount(@Body() body: any, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'auth',
            {
                method: 'POST',
                path: '/api/v1/auth/verifyAccount',
                body,
                headers: this.extractHeaders(req),
            },
            this.extractToken(req)
        );
    }

    @Post('send-code-change-password')
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'Gửi mã đổi password' })
    async sendCodeChangePassword(@Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'auth',
            {
                method: 'POST',
                path: '/api/v1/auth/send-code-change-password',
                headers: this.extractHeaders(req),
            },
            this.extractToken(req)
        );
    }

    @Post('change-password')
    @ApiBearerAuth('access-token')
    @ApiOperation({ summary: 'Đổi password' })
    async changePassword(@Body() body: any, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'auth',
            {
                method: 'POST',
                path: '/api/v1/auth/change-password',
                body,
                headers: this.extractHeaders(req),
            },
            this.extractToken(req)
        );
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
        if (authHeader?.startsWith('Bearer ')) return authHeader.substring(7);
        return req.cookies?.accessToken || '';
    }
}
