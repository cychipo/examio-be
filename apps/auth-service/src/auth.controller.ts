import {
    Controller,
    Post,
    Body,
    UseGuards,
    Req,
    Get,
    Res,
    UnauthorizedException,
} from '@nestjs/common';
import { AuthService, DeviceInfo } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto, LoginResponse } from './dto/login.dto';
import {
    ApiTags,
    ApiResponse,
    ApiOperation,
    ApiExtraModels,
    ApiCookieAuth,
} from '@nestjs/swagger';
import {
    AuthGuard,
    GoogleAuthGuard,
    FacebookAuthGuard,
    GithubAuthGuard,
    getCookieConfig,
} from '@examio/common';
import {
    AuthenticatedRequest,
    AuthenticatedOauthRequest,
} from './dto/request-with-auth.dto';
import { Response as ExpressResponse, Request } from 'express';
import {
    LoginResponseDto,
    RegisterResponseDto,
    LogoutResponseDto,
    AuthMessageResponseDto,
    GetUserResponseDto,
    RefreshTokenResponseDto,
} from './dto/auth-response.dto';
import * as crypto from 'crypto';

@ApiTags('Auth')
@ApiExtraModels(
    RegisterDto,
    LoginDto,
    RegisterResponseDto,
    LoginResponseDto,
    LogoutResponseDto,
    AuthMessageResponseDto,
    GetUserResponseDto,
    RefreshTokenResponseDto
)
@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) {}

    @Post('register')
    @ApiOperation({ summary: 'Register a new user' })
    @ApiResponse({
        status: 201,
        description: 'User registered successfully',
        type: RegisterResponseDto,
    })
    async register(
        @Body() registerDto: RegisterDto,
        @Res({ passthrough: true }) res: ExpressResponse,
        @Req() request: Request
    ) {
        // Extract device info from request
        const deviceInfo = this.extractDeviceInfo(request);

        const { token, user, success, sessionId, deviceId, message } =
            await this.authService.register(registerDto, deviceInfo);

        const cookieConfig = getCookieConfig({
            feOrigin: request.headers.origin,
            isProductionBE: process.env.NODE_ENV === 'production',
        });

        // Set cookies like login does
        res.cookie('token', token, cookieConfig);
        if (sessionId) {
            res.cookie('session_id', sessionId, cookieConfig);
        }

        return {
            message,
            user,
            success,
            token,
            deviceId,
        };
    }

    @Post('login')
    @ApiOperation({
        summary: 'Login a user',
        description:
            'Đăng nhập và tự động set JWT token vào cookie. Sau khi login thành công, các API có khóa sẽ tự động authenticate qua cookie.',
    })
    @ApiResponse({
        status: 200,
        description:
            'User logged in successfully. JWT token is automatically stored in cookie.',
        type: LoginResponseDto,
    })
    async login(
        @Body() loginDto: LoginDto,
        @Res({ passthrough: true }) res: ExpressResponse,
        @Req() request: Request
    ): Promise<LoginResponse> {
        // Extract device info from request
        const deviceInfo = this.extractDeviceInfo(request);

        const { token, user, success, sessionId, deviceId } =
            await this.authService.login(loginDto, deviceInfo);

        const cookieConfig = getCookieConfig({
            feOrigin: request.headers.origin,
            isProductionBE: process.env.NODE_ENV === 'production',
        });

        res.cookie('token', token, cookieConfig);
        if (sessionId) {
            res.cookie('session_id', sessionId, cookieConfig);
        }

        return {
            user,
            success,
            token,
            deviceId,
        };
    }

    @Post('logout')
    @ApiOperation({ summary: 'Logout a user' })
    @ApiResponse({
        status: 200,
        description: 'User logged out successfully',
        type: LogoutResponseDto,
    })
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    async logout(
        @Req() request: Request,
        @Res({ passthrough: true }) response: ExpressResponse
    ) {
        // Extract session ID from cookie
        const sessionId = request.cookies?.session_id;

        // Deactivate session in database if exists
        if (sessionId) {
            await this.authService.logout(sessionId);
        }

        // Clear cookies
        response.clearCookie('token');
        response.clearCookie('refreshToken');
        response.clearCookie('session_id');
        return { success: true };
    }

    @Post('refresh')
    @ApiOperation({ summary: 'Refresh access token using refresh token' })
    @ApiResponse({
        status: 200,
        description: 'New access token generated',
        type: RefreshTokenResponseDto,
    })
    async refreshToken(
        @Req() request: Request,
        @Res({ passthrough: true }) response: ExpressResponse
    ) {
        // Extract refresh token from cookie
        const refreshToken = request.cookies?.refreshToken;

        if (!refreshToken) {
            throw new UnauthorizedException('Refresh token not found');
        }

        try {
            const result =
                await this.authService.refreshAccessToken(refreshToken);

            const cookieConfig = getCookieConfig({
                feOrigin: request.headers.origin,
                isProductionBE: process.env.NODE_ENV === 'production',
            });

            // Set new access token
            response.cookie('token', result.token, cookieConfig);
            response.cookie('accessToken', result.token, cookieConfig);

            return {
                success: true,
                token: result.token,
            };
        } catch (error) {
            throw new UnauthorizedException('Invalid or expired refresh token');
        }
    }

    @Post('sendVerificationEmail')
    @ApiOperation({ summary: 'Send verification email' })
    @ApiResponse({
        status: 200,
        description: 'Verification email sent successfully',
        type: AuthMessageResponseDto,
    })
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    async sendVerificationEmail(@Req() req: AuthenticatedRequest) {
        return this.authService.sendVerificationEmail(req.user);
    }

    @Post('verifyAccount')
    @ApiOperation({ summary: 'Verify user account' })
    @ApiResponse({
        status: 200,
        description: 'User account verified successfully',
        type: AuthMessageResponseDto,
    })
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    async verifyAccount(
        @Body('code') code: string,
        @Req() req: AuthenticatedRequest
    ) {
        return this.authService.verifyAccount(req.user.id, code);
    }

    @Post('send-code-reset-password')
    @ApiOperation({ summary: 'Send code to reset password' })
    @ApiResponse({
        status: 200,
        description: 'Code sent successfully',
        type: AuthMessageResponseDto,
    })
    async sendCodeResetPassword(@Body('email') email: string) {
        return this.authService.sendCodeToResetPassword(email);
    }

    @Post('reset-password')
    @ApiOperation({ summary: 'Reset user password' })
    @ApiResponse({
        status: 200,
        description: 'Password reset successfully',
        type: AuthMessageResponseDto,
    })
    async resetPassword(
        @Body('email') email: string,
        @Body('code') code: string,
        @Body('newPassword') newPassword: string
    ) {
        return this.authService.resetPassword(email, code, newPassword);
    }

    @Post('send-code-change-password')
    @ApiOperation({ summary: 'Send code to change password (authenticated)' })
    @ApiResponse({
        status: 200,
        description: 'Code sent successfully',
        type: AuthMessageResponseDto,
    })
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    async sendCodeChangePassword(@Req() req: AuthenticatedRequest) {
        return this.authService.sendCodeToChangePassword(req.user);
    }

    @Post('change-password')
    @ApiOperation({ summary: 'Change user password (authenticated)' })
    @ApiResponse({
        status: 200,
        description: 'Password changed successfully',
        type: AuthMessageResponseDto,
    })
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    async changePassword(
        @Body('code') code: string,
        @Body('currentPassword') currentPassword: string,
        @Body('newPassword') newPassword: string,
        @Req() req: AuthenticatedRequest
    ) {
        return this.authService.changePassword(
            req.user,
            code,
            currentPassword,
            newPassword
        );
    }

    @Get('google')
    @UseGuards(GoogleAuthGuard)
    @ApiOperation({ summary: 'Đăng nhập Google OAuth' })
    async googleAuth(@Req() req) {
        // Khởi tạo Google OAuth flow
    }

    @Get('google/callback')
    @UseGuards(GoogleAuthGuard)
    @ApiOperation({ summary: 'Google OAuth callback' })
    async googleAuthRedirect(
        @Req() req: AuthenticatedOauthRequest,
        @Res({ passthrough: true }) res: ExpressResponse,
        @Req() request: Request
    ) {
        const { token, sessionId } = req.user;

        const cookieConfig = getCookieConfig({
            feOrigin: request.headers.origin,
            isProductionBE: process.env.NODE_ENV === 'production',
        });

        res.cookie('token', token, cookieConfig);
        if (sessionId) {
            res.cookie('session_id', sessionId, cookieConfig);
        }

        const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:3001').replace(/\/+$/, '');
        res.redirect(`${frontendUrl}/`);
    }

    @Get('facebook')
    @UseGuards(FacebookAuthGuard)
    @ApiOperation({ summary: 'Đăng nhập Facebook OAuth' })
    async facebookLogin() {
        // Redirects to Facebook
    }

    @Get('facebook/callback')
    @UseGuards(FacebookAuthGuard)
    @ApiOperation({ summary: 'Facebook OAuth callback' })
    async facebookCallback(
        @Req() req: AuthenticatedOauthRequest,
        @Res({ passthrough: true }) res: ExpressResponse,
        @Req() request: Request
    ) {
        const { token, sessionId } = req.user;

        const cookieConfig = getCookieConfig({
            feOrigin: request.headers.origin,
            isProductionBE: process.env.NODE_ENV === 'production',
        });

        res.cookie('token', token, cookieConfig);
        if (sessionId) {
            res.cookie('session_id', sessionId, cookieConfig);
        }

        const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:3001').replace(/\/+$/, '');
        res.redirect(`${frontendUrl}/`);
    }

    @Get('github')
    @UseGuards(GithubAuthGuard)
    @ApiOperation({ summary: 'Đăng nhập GitHub OAuth' })
    async githubLogin() {
        // Passport sẽ redirect tới GitHub
    }

    @Get('github/callback')
    @UseGuards(GithubAuthGuard)
    @ApiOperation({ summary: 'GitHub OAuth callback' })
    async githubLoginCallback(
        @Req() req: AuthenticatedOauthRequest,
        @Res({ passthrough: true }) res: ExpressResponse,
        @Req() request: Request
    ) {
        const { token, sessionId } = req.user;

        const cookieConfig = getCookieConfig({
            feOrigin: request.headers.origin,
            isProductionBE: process.env.NODE_ENV === 'production',
        });

        res.cookie('token', token, cookieConfig);
        if (sessionId) {
            res.cookie('session_id', sessionId, cookieConfig);
        }

        const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:3001').replace(/\/+$/, '');
        res.redirect(`${frontendUrl}/`);
    }

    @Get('me')
    @UseGuards(AuthGuard)
    @ApiOperation({ summary: 'Lấy thông tin người dùng hiện tại' })
    @ApiCookieAuth('cookie-auth')
    @ApiResponse({
        status: 200,
        description: 'User information retrieved successfully',
        type: GetUserResponseDto,
    })
    async getUser(@Req() req: AuthenticatedRequest) {
        return this.authService.getUser(req.user);
    }

    private extractDeviceInfo(request: Request): DeviceInfo {
        // Get device ID from header or generate fallback
        let deviceId = request.headers['x-device-id'] as string;
        if (!deviceId) {
            // Fallback: generate from User-Agent + IP + timestamp
            const userAgent = request.headers['user-agent'] || '';
            const ip = this.getClientIp(request);
            deviceId = crypto
                .createHash('md5')
                .update(`${userAgent}-${ip}-${Date.now()}`)
                .digest('hex');
        }

        return {
            deviceId,
            userAgent: request.headers['user-agent'],
            ipAddress: this.getClientIp(request),
        };
    }

    private getClientIp(request: Request): string | undefined {
        // Check for proxy headers
        const forwardedFor = request.headers['x-forwarded-for'];
        if (forwardedFor) {
            const ips = (forwardedFor as string).split(',');
            return ips[0].trim();
        }

        const realIp = request.headers['x-real-ip'] as string;
        if (realIp) {
            return realIp;
        }

        return request.ip;
    }
}
