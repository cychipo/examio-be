import {
    Controller,
    Post,
    Body,
    UseGuards,
    Req,
    Get,
    Res,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto, LoginResponse } from './dto/login.dto';
import {
    ApiTags,
    ApiResponse,
    ApiOperation,
    ApiExtraModels,
    ApiBearerAuth,
    ApiCookieAuth,
} from '@nestjs/swagger';
import { AuthGuard } from 'src/common/guard/auth.guard';
import {
    AuthenticatedRequest,
    AuthenticatedOauthRequest,
} from './dto/request-with-auth.dto';
import { GoogleAuthGuard } from 'src/common/guard/google-auth.guard';
import { Response as ExpressResponse } from 'express';
import { FacebookAuthGuard } from '../../common/guard/facebook-auth.guard';
import { GithubAuthGuard } from 'src/common/guard/github-auth.guard';

@ApiTags('Auth')
@ApiExtraModels(RegisterDto, LoginDto)
@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) {}

    /**
     * Helper: Get cookie options based on environment
     * - Development: no domain, sameSite=lax, http allowed
     * - Production: shared domain, sameSite=none, https required
     */
    private getCookieOptions() {
        const isProduction = process.env.NODE_ENV === 'production';

        const options: any = {
            httpOnly: true,
            secure: isProduction,
            sameSite: isProduction ? 'none' : 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
            path: '/',
        };

        // Only set domain in production for cross-subdomain cookie sharing
        if (isProduction && process.env.COOKIE_DOMAIN) {
            options.domain = process.env.COOKIE_DOMAIN;
        }

        return options;
    }

    private handleOAuthCallback(
        res: ExpressResponse,
        token: string | undefined,
        provider: string
    ) {
        if (!token) {
            const frontendUrl =
                process.env.FRONTEND_URL || 'http://localhost:3001';
            return res.redirect(
                `${frontendUrl}/login?error=oauth_failed&provider=${provider}`
            );
        }

        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
        const callbackUrl = `${frontendUrl}/auth/callback?token=${token}&provider=${provider}`;

        res.redirect(callbackUrl);
    }

    @Post('register')
    @ApiOperation({ summary: 'Register a new user' })
    @ApiResponse({
        status: 201,
        description: 'User registered successfully',
        type: RegisterDto,
    })
    async register(@Body() registerDto: RegisterDto) {
        return this.authService.register(registerDto);
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
        type: LoginResponse,
    })
    async login(
        @Body() loginDto: LoginDto,
        @Res({ passthrough: true }) res: ExpressResponse
    ): Promise<LoginResponse> {
        const { token, user, success } = await this.authService.login(loginDto);

        // Set cookie using helper
        res.cookie('token', token, this.getCookieOptions());

        return {
            user,
            success,
        };
    }

    @Post('logout')
    @ApiOperation({ summary: 'Logout a user' })
    @ApiResponse({
        status: 200,
        description: 'User logged out successfully',
    })
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    async logout(@Res({ passthrough: true }) response: ExpressResponse) {
        response.clearCookie('token');
        return { success: true };
    }

    @Post('sendVerificationEmail')
    @ApiOperation({ summary: 'Send verification email' })
    @ApiResponse({
        status: 200,
        description: 'Verification email sent successfully',
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
    })
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    async verifyAccount(
        @Body('code') code: string,
        @Req() req: AuthenticatedRequest
    ) {
        return this.authService.verifyAccount(code, req.user.id);
    }

    @Post('send-code-reset-password')
    @ApiOperation({ summary: 'Send code to reset password' })
    @ApiResponse({
        status: 200,
        description: 'Code sent successfully',
    })
    async sendCodeResetPassword(@Body('email') email: string) {
        return this.authService.sendCodeToResetPassword(email);
    }

    @Post('reset-password')
    @ApiOperation({ summary: 'Reset user password' })
    @ApiResponse({
        status: 200,
        description: 'Password reset successfully',
    })
    async resetPassword(
        @Body('email') email: string,
        @Body('code') code: string,
        @Body('newPassword') newPassword: string
    ) {
        return this.authService.resetPassword(email, code, newPassword);
    }

    @Get('google')
    @UseGuards(GoogleAuthGuard)
    @ApiOperation({ summary: 'Đăng nhập Google OAuth' })
    async googleAuth(@Req() req) {
        // Khởi tạo Google OAuth flow
    }

    @Get('google/callback')
    @UseGuards(GoogleAuthGuard)
    @ApiOperation({
        summary: 'Google OAuth callback',
        description:
            'Redirects to frontend with token in URL. Frontend will set cookie.',
    })
    async googleAuthRedirect(
        @Req() req: AuthenticatedOauthRequest,
        @Res({ passthrough: true }) res: ExpressResponse
    ) {
        const { token } = req.user;
        this.handleOAuthCallback(res, token, 'google');
    }

    @Get('facebook')
    @UseGuards(FacebookAuthGuard)
    @ApiOperation({ summary: 'Đăng nhập Facebook OAuth' })
    async facebookLogin() {
        // Redirects to Facebook
    }

    @Get('facebook/callback')
    @UseGuards(FacebookAuthGuard)
    @ApiOperation({
        summary: 'Facebook OAuth callback',
        description:
            'Redirects to frontend with token in URL. Frontend will set cookie.',
    })
    async facebookCallback(
        @Req() req: AuthenticatedOauthRequest,
        @Res({ passthrough: true }) res: ExpressResponse
    ) {
        const { token } = req.user;
        this.handleOAuthCallback(res, token, 'facebook');
    }

    @Get('github')
    @UseGuards(GithubAuthGuard)
    @ApiOperation({ summary: 'Đăng nhập GitHub OAuth' })
    async githubLogin() {
        // Passport sẽ redirect tới GitHub
    }

    @Get('github/callback')
    @UseGuards(GithubAuthGuard)
    @ApiOperation({
        summary: 'GitHub OAuth callback',
        description:
            'Redirects to frontend with token in URL. Frontend will set cookie.',
    })
    async githubLoginCallback(
        @Req() req: AuthenticatedOauthRequest,
        @Res({ passthrough: true }) res: ExpressResponse
    ) {
        const { token } = req.user;
        this.handleOAuthCallback(res, token, 'github');
    }
}
