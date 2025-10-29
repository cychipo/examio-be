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
    ApiCookieAuth,
} from '@nestjs/swagger';
import { AuthGuard } from 'src/common/guard/auth.guard';
import {
    AuthenticatedRequest,
    AuthenticatedOauthRequest,
} from './dto/request-with-auth.dto';
import { GoogleAuthGuard } from 'src/common/guard/google-auth.guard';
import { Response as ExpressResponse, Request } from 'express';
import { FacebookAuthGuard } from '../../common/guard/facebook-auth.guard';
import { GithubAuthGuard } from 'src/common/guard/github-auth.guard';
import {
    LoginResponseDto,
    RegisterResponseDto,
    LogoutResponseDto,
    MessageResponseDto,
    GetUserResponseDto,
} from './dto/auth-response.dto';
import { getCookieConfig } from 'src/common/utils/cookie-config';

@ApiTags('Auth')
@ApiExtraModels(
    RegisterDto,
    LoginDto,
    RegisterResponseDto,
    LoginResponseDto,
    LogoutResponseDto,
    MessageResponseDto,
    GetUserResponseDto
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
        type: LoginResponseDto,
    })
    async login(
        @Body() loginDto: LoginDto,
        @Res({ passthrough: true }) res: ExpressResponse,
        @Req() request: Request
    ): Promise<LoginResponse> {
        const { token, user, success } = await this.authService.login(loginDto);

        const cookieConfig = getCookieConfig({
            feOrigin: request.headers.origin,
            isProductionBE: process.env.NODE_ENV === 'production',
        });

        res.cookie('token', token, cookieConfig);

        return {
            user,
            success,
            token,
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
    async logout(@Res({ passthrough: true }) response: ExpressResponse) {
        response.clearCookie('token');
        return { success: true };
    }

    @Post('sendVerificationEmail')
    @ApiOperation({ summary: 'Send verification email' })
    @ApiResponse({
        status: 200,
        description: 'Verification email sent successfully',
        type: MessageResponseDto,
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
        type: MessageResponseDto,
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
        type: MessageResponseDto,
    })
    async sendCodeResetPassword(@Body('email') email: string) {
        return this.authService.sendCodeToResetPassword(email);
    }

    @Post('reset-password')
    @ApiOperation({ summary: 'Reset user password' })
    @ApiResponse({
        status: 200,
        description: 'Password reset successfully',
        type: MessageResponseDto,
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
    @ApiOperation({ summary: 'Google OAuth callback' })
    async googleAuthRedirect(
        @Req() req: AuthenticatedOauthRequest,
        @Res({ passthrough: true }) res: ExpressResponse,
        @Req() request: Request
    ) {
        const { token } = req.user;

        const cookieConfig = getCookieConfig({
            feOrigin: request.headers.origin,
            isProductionBE: process.env.NODE_ENV === 'production',
        });

        res.cookie('token', token, cookieConfig);

        const isLocalFE =
            request.headers.origin?.includes('localhost') ||
            request.headers.origin?.includes('127.0.0.1');
        const frontendUrl = !isLocalFE
            ? process.env.FRONTEND_URL
            : 'http://localhost:3001';
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
        const { token } = req.user;

        const cookieConfig = getCookieConfig({
            feOrigin: request.headers.origin,
            isProductionBE: process.env.NODE_ENV === 'production',
        });

        res.cookie('token', token, cookieConfig);

        const isLocalFE =
            request.headers.origin?.includes('localhost') ||
            request.headers.origin?.includes('127.0.0.1');
        const frontendUrl = !isLocalFE
            ? process.env.FRONTEND_URL
            : 'http://localhost:3001';
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
        const { token } = req.user;

        const cookieConfig = getCookieConfig({
            feOrigin: request.headers.origin,
            isProductionBE: process.env.NODE_ENV === 'production',
        });

        res.cookie('token', token, cookieConfig);

        const isLocalFE =
            request.headers.origin?.includes('localhost') ||
            request.headers.origin?.includes('127.0.0.1');
        const frontendUrl = !isLocalFE
            ? process.env.FRONTEND_URL
            : 'http://localhost:3001';
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
}
