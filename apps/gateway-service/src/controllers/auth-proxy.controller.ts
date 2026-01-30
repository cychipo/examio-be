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

        this.setAuthCookies(res, result, req);
        return res.json(result);
    }

    @Post('register')
    @ApiOperation({ summary: 'Đăng ký tài khoản mới' })
    @ApiResponse({ status: 201, description: 'Đăng ký thành công' })
    async register(
        @Body() body: any,
        @Req() req: Request,
        @Res() res: Response
    ) {
        const result = await this.proxyService.forward('auth', {
            method: 'POST',
            path: '/api/v1/auth/register',
            body,
            headers: this.extractHeaders(req),
        });

        this.setAuthCookies(res, result, req);
        return res.json(result);
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
    async googleAuth(@Req() req: Request, @Res() res: Response) {
        // Proxy to auth service - get OAuth redirect URL without following
        const result = await this.proxyService.forwardWithRedirect('auth', {
            method: 'GET',
            path: '/api/v1/auth/google',
            headers: this.extractHeaders(req),
        });
        // Redirect browser to OAuth provider
        if (result.redirectUrl) {
            return res.redirect(result.redirectUrl);
        }
        return res.json(result.data || { error: 'OAuth redirect failed' });
    }

    @Get('google/callback')
    @ApiOperation({ summary: 'Google OAuth callback' })
    async googleCallback(@Req() req: Request, @Res() res: Response) {
        const queryString = req.url.split('?')[1] || '';
        const result = await this.proxyService.forwardWithRedirect('auth', {
            method: 'GET',
            path: `/api/v1/auth/google/callback?${queryString}`,
            headers: this.extractHeaders(req),
        });
        // Handle auth response - set cookies and redirect to frontend
        return this.handleOAuthCallback(result, res);
    }

    @Get('facebook')
    @ApiOperation({ summary: 'Đăng nhập bằng Facebook' })
    async facebookAuth(@Req() req: Request, @Res() res: Response) {
        const result = await this.proxyService.forwardWithRedirect('auth', {
            method: 'GET',
            path: '/api/v1/auth/facebook',
            headers: this.extractHeaders(req),
        });
        if (result.redirectUrl) {
            return res.redirect(result.redirectUrl);
        }
        return res.json(result.data || { error: 'OAuth redirect failed' });
    }

    @Get('facebook/callback')
    @ApiOperation({ summary: 'Facebook OAuth callback' })
    async facebookCallback(@Req() req: Request, @Res() res: Response) {
        const queryString = req.url.split('?')[1] || '';
        const result = await this.proxyService.forwardWithRedirect('auth', {
            method: 'GET',
            path: `/api/v1/auth/facebook/callback?${queryString}`,
            headers: this.extractHeaders(req),
        });
        return this.handleOAuthCallback(result, res);
    }

    @Get('github')
    @ApiOperation({ summary: 'Đăng nhập bằng GitHub' })
    async githubAuth(@Req() req: Request, @Res() res: Response) {
        const result = await this.proxyService.forwardWithRedirect('auth', {
            method: 'GET',
            path: '/api/v1/auth/github',
            headers: this.extractHeaders(req),
        });
        if (result.redirectUrl) {
            return res.redirect(result.redirectUrl);
        }
        return res.json(result.data || { error: 'OAuth redirect failed' });
    }

    @Get('github/callback')
    @ApiOperation({ summary: 'GitHub OAuth callback' })
    async githubCallback(@Req() req: Request, @Res() res: Response) {
        const queryString = req.url.split('?')[1] || '';
        const result = await this.proxyService.forwardWithRedirect('auth', {
            method: 'GET',
            path: `/api/v1/auth/github/callback?${queryString}`,
            headers: this.extractHeaders(req),
        });
        return this.handleOAuthCallback(result, res);
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
                cookies: req.cookies,
            },
            this.extractToken(req)
        );
        const cookieOptions: any = {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: (process.env.NODE_ENV === 'production'
                ? 'none'
                : 'lax') as any,
            path: '/',
        };
        if (process.env.NODE_ENV === 'production') {
            cookieOptions.domain = '.fayedark.com';
        }

        res.clearCookie('accessToken', cookieOptions);
        res.clearCookie('token', cookieOptions);
        res.clearCookie('session_id', cookieOptions);
        res.clearCookie('refreshToken', cookieOptions);
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
            'x-device-id': (req.headers['x-device-id'] as string) || '',
            'x-forwarded-for':
                (req.headers['x-forwarded-for'] as string) ||
                req.socket.remoteAddress ||
                '',
        };
    }

    private extractToken(req: Request): string {
        const authHeader = req.headers.authorization;
        if (authHeader?.startsWith('Bearer ')) return authHeader.substring(7);
        // Check both cookie names for compatibility
        return req.cookies?.token || req.cookies?.accessToken || '';
    }

    private setAuthCookies(res: Response, result: any, req: Request): void {
        if (!result || !result.token) return;

        const isProduction = process.env.NODE_ENV === 'production';
        const feOrigin = req.headers.origin;
        const isLocalFE =
            feOrigin?.includes('localhost') || feOrigin?.includes('127.0.0.1');

        const cookieOptions: any = {
            httpOnly: true,
            secure: isProduction && !isLocalFE,
            sameSite: isProduction && !isLocalFE ? 'none' : 'lax',
            maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
            path: '/',
        };

        // BẮT BUỘC: Set domain cho production để share giữa subdomains
        if (isProduction && !isLocalFE) {
            cookieOptions.domain = '.fayedark.com';
        }

        // Set token cookies
        res.cookie('token', result.token, cookieOptions);
        res.cookie('accessToken', result.token, cookieOptions);

        if (result.sessionId) {
            res.cookie('session_id', result.sessionId, cookieOptions);
        }

        if (result.refreshToken) {
            res.cookie('refreshToken', result.refreshToken, cookieOptions);
        }
    }

    private handleOAuthCallback(result: any, res: Response): void {
        /**
         * Handle OAuth callback response from auth-service.
         * Sets cookies and redirects to frontend.
         */
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

        if (!result) {
            res.redirect(`${frontendUrl}/login?error=auth_failed`);
            return;
        }

        // Relay cookies from auth service response
        if (result.headers && result.headers['set-cookie']) {
            res.setHeader('Set-Cookie', result.headers['set-cookie']);
        }

        // Redirect to frontend - auth service may provide a redirectUrl
        const redirectUrl = result.redirectUrl || frontendUrl;
        res.redirect(redirectUrl);
    }
}
