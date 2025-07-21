import {
    Controller,
    Post,
    Body,
    UseGuards,
    Req,
    Get,
    Response,
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
} from '@nestjs/swagger';
import { AuthGuard } from 'src/common/guard/auth.guard';
import { AuthenticatedRequest } from './dto/request-with-auth.dto';
import { GoogleAuthGuard } from 'src/common/guard/google-auth.guard';
@ApiTags('Auth')
@ApiExtraModels(RegisterDto, LoginDto)
@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) {}

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
    @ApiOperation({ summary: 'Login a user' })
    @ApiResponse({
        status: 200,
        description: 'User logged in successfully',
        type: LoginResponse,
    })
    async login(@Body() loginDto: LoginDto): Promise<LoginResponse> {
        return this.authService.login(loginDto);
    }

    @Post('sendVerificationEmail')
    @ApiOperation({ summary: 'Send verification email' })
    @ApiResponse({
        status: 200,
        description: 'Verification email sent successfully',
    })
    @UseGuards(AuthGuard)
    @ApiBearerAuth('JWT')
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
    @ApiBearerAuth('JWT')
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
    @ApiOperation({ summary: 'Google OAuth callback' })
    async googleAuthRedirect(@Req() req: AuthenticatedRequest) {
        return req.user;
    }
}
