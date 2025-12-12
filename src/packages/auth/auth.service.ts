import {
    Injectable,
    ConflictException,
    NotFoundException,
    InternalServerErrorException,
    BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { JwtService } from '@nestjs/jwt';
import { MailService } from 'src/common/services/mail.service';
import { PasswordService } from 'src/common/services/password.service';
import { RegisterDto } from './dto/register.dto';
import { GenerateIdService } from 'src/common/services/generate-id.service';
import { sanitizeUser } from 'src/common/utils/sanitize-user';
import { User } from '@prisma/client';
import { generateCode } from 'src/common/utils/generate-code';
import { WalletService } from 'src/packages/finance/modules/wallet/wallet.service';
import { UserRepository } from './repositories/user.repository';
import { UserSessionRepository } from '../devices/repositories/user-session.repository';

export interface DeviceInfo {
    deviceId: string;
    userAgent?: string;
    ipAddress?: string;
}

@Injectable()
export class AuthService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly userRepository: UserRepository,
        private readonly userSessionRepository: UserSessionRepository,
        private readonly jwtService: JwtService,
        private readonly mailService: MailService,
        private readonly passwordService: PasswordService,
        private readonly generateIdService: GenerateIdService,
        private readonly walletService: WalletService
    ) {}

    async login(loginDto: LoginDto, deviceInfo?: DeviceInfo) {
        const { credential, password } = loginDto;
        if (!credential || !password) {
            throw new BadRequestException('Thông tin đăng nhập không hợp lệ');
        }
        try {
            // Validate user credentials using repository
            const user = await this.userRepository.findByCredential(credential);
            if (!user) {
                throw new NotFoundException('Không tìm thấy người dùng');
            }
            // Check password
            const isPasswordValid = await this.passwordService.comparePasswords(
                password,
                user.password || ''
            );
            if (!isPasswordValid) {
                throw new BadRequestException(
                    'Thông tin đăng nhập không hợp lệ'
                );
            }
            // Generate JWT token
            const token = this.jwtService.sign({ userId: user.id });

            // Create session if deviceInfo provided
            let sessionId: string | undefined;
            if (deviceInfo) {
                sessionId = await this.createSession(user.id, deviceInfo);
            }

            return {
                token,
                user: sanitizeUser(user),
                success: true,
                sessionId,
                deviceId: deviceInfo?.deviceId,
            };
        } catch (error) {
            if (
                error instanceof NotFoundException ||
                error instanceof BadRequestException
            ) {
                throw error;
            }
            throw new InternalServerErrorException(
                'Đăng nhập không thành công'
            );
        }
    }

    async register(registerDto: RegisterDto) {
        const { username, email, password } = registerDto;
        if (!username || !email || !password) {
            throw new BadRequestException('Thông tin đăng ký không hợp lệ');
        }

        try {
            // check valid email and username using repository
            const [emailExists, usernameExists] = await Promise.all([
                this.userRepository.emailExists(email),
                this.userRepository.usernameExists(username),
            ]);

            if (emailExists) {
                throw new ConflictException('Email đã được sử dụng');
            }

            if (usernameExists) {
                throw new ConflictException('Username đã được sử dụng');
            }

            // Hash the password
            const hashedPassword =
                await this.passwordService.hashPassword(password);

            // Create new user and wallet using transaction
            const newUser = await this.prisma.$transaction(async (tx) => {
                // Create user using repository
                const user = await this.userRepository.create({
                    id: this.generateIdService.generateId(),
                    username,
                    email,
                    password: hashedPassword,
                });

                // Create wallet
                await tx.wallet.create({
                    data: {
                        id: this.generateIdService.generateId(),
                        userId: user.id,
                        balance: 20,
                    },
                });

                // Create default subscription (tier NONE)
                await tx.userSubscription.create({
                    data: {
                        id: this.generateIdService.generateId(),
                        userId: user.id,
                        tier: 0, // NONE
                        billingCycle: 'monthly',
                        isActive: false,
                    },
                });

                return user;
            });

            // Send welcome email
            this.mailService.sendMail(
                email,
                'Chào mừng bạn đến với CodeCraft',
                'welcome.template',
                {
                    username: newUser.username,
                    useremail: newUser.email,
                    loginUrl: `${process.env.FRONTEND_URL}/login`,
                }
            );

            return {
                message: 'Đăng ký thành công',
                user: sanitizeUser(newUser),
                success: true,
            };
        } catch (error) {
            if (error instanceof ConflictException) {
                throw error;
            }
            console.log(error);
            throw new InternalServerErrorException('Đăng ký không thành công');
        }
    }

    async sendVerificationEmail(user: User) {
        try {
            // Check if user is already verified
            if (user.isVerified) {
                return { message: 'Tài khoản đã được xác minh' };
            }

            const code = generateCode(6);

            // Use upsert to handle existing verification code
            await this.prisma.verifyAccountCode.upsert({
                where: { userId: user.id },
                update: {
                    code,
                    expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
                },
                create: {
                    id: this.generateIdService.generateId(),
                    userId: user.id,
                    code,
                    expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
                },
            });

            // Send verification email
            this.mailService.sendMail(
                user.email,
                'Xác minh tài khoản của bạn',
                'verify-account.template',
                {
                    username: user.username,
                    verificationCode: code,
                }
            );

            return { message: 'Email xác minh đã được gửi' };
        } catch (error) {
            console.log(error);
            throw new InternalServerErrorException(
                'Gửi email không thành công'
            );
        }
    }

    async verifyAccount(userId: string, code: string) {
        try {
            const verificationCode =
                await this.prisma.verifyAccountCode.findUnique({
                    where: { userId },
                });
            console.log(
                '🚀 ~ AuthService ~ verifyAccount ~ verificationCode:',
                verificationCode
            );

            if (!verificationCode) {
                throw new NotFoundException('Mã xác minh không hợp lệ');
            }

            if (verificationCode.code !== code) {
                throw new BadRequestException('Mã xác minh không chính xác');
            }

            if (new Date() > verificationCode.expiresAt) {
                throw new BadRequestException('Mã xác minh đã hết hạn');
            }

            // Mark user as verified using repository - pass userId for proper cache invalidation
            await this.userRepository.update(
                userId,
                { isVerified: true },
                userId
            );

            // Clean up verification code
            await this.prisma.verifyAccountCode.delete({
                where: { userId },
            });

            return { message: 'Tài khoản đã được xác minh thành công' };
        } catch (error) {
            if (
                error instanceof NotFoundException ||
                error instanceof BadRequestException
            ) {
                throw error;
            }
            throw new InternalServerErrorException(
                'Xác minh tài khoản không thành công'
            );
        }
    }

    async sendCodeToResetPassword(email: string) {
        try {
            const user = await this.userRepository.findByEmail(email, false);

            if (!user) {
                throw new NotFoundException('Không tìm thấy người dùng');
            }

            const code = generateCode(6);

            const existingCode = await this.prisma.resetPasswordCode.findUnique(
                {
                    where: { userId: user.id },
                }
            );

            if (existingCode) {
                await this.prisma.resetPasswordCode.update({
                    where: { userId: user.id },
                    data: {
                        code,
                        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
                    },
                });
            } else {
                await this.prisma.resetPasswordCode.create({
                    data: {
                        id: this.generateIdService.generateId(),
                        userId: user.id,
                        code,
                        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
                    },
                });
            }

            // Send reset password email
            this.mailService.sendMail(
                user.email,
                'Yêu cầu đặt lại mật khẩu',
                'reset-password.template',
                {
                    username: user.username,
                    resetCode: code,
                }
            );

            return { message: 'Email đặt lại mật khẩu đã được gửi' };
        } catch (error) {
            console.log(error);
            throw new InternalServerErrorException(
                'Gửi email đặt lại mật khẩu không thành công'
            );
        }
    }

    async resetPassword(email: string, code: string, newPassword: string) {
        try {
            const user = await this.userRepository.findByEmail(email, false);

            if (!user) {
                throw new NotFoundException('Không tìm thấy người dùng');
            }

            const resetCode = await this.prisma.resetPasswordCode.findUnique({
                where: { userId: user.id },
            });

            if (!resetCode) {
                throw new NotFoundException('Mã đặt lại mật khẩu không hợp lệ');
            }

            if (resetCode.code !== code) {
                throw new BadRequestException(
                    'Mã đặt lại mật khẩu không chính xác'
                );
            }

            if (new Date() > resetCode.expiresAt) {
                throw new BadRequestException('Mã đặt lại mật khẩu đã hết hạn');
            }

            // Update user password using repository - pass userId for proper cache invalidation
            await this.userRepository.update(
                user.id,
                {
                    password:
                        await this.passwordService.hashPassword(newPassword),
                },
                user.id
            );

            // Clean up reset code
            await this.prisma.resetPasswordCode.delete({
                where: { userId: user.id },
            });

            return { message: 'Mật khẩu đã được đặt lại thành công' };
        } catch (error) {
            if (
                error instanceof NotFoundException ||
                error instanceof BadRequestException
            ) {
                throw error;
            }
            throw new InternalServerErrorException(
                'Đặt lại mật khẩu không thành công'
            );
        }
    }

    /**
     * Send verification code to change password (for authenticated users)
     */
    async sendCodeToChangePassword(user: User) {
        try {
            const code = generateCode(6);

            const existingCode = await this.prisma.resetPasswordCode.findUnique(
                {
                    where: { userId: user.id },
                }
            );

            if (existingCode) {
                await this.prisma.resetPasswordCode.update({
                    where: { userId: user.id },
                    data: {
                        code,
                        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
                    },
                });
            } else {
                await this.prisma.resetPasswordCode.create({
                    data: {
                        id: this.generateIdService.generateId(),
                        userId: user.id,
                        code,
                        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
                    },
                });
            }

            // Send change password email
            this.mailService.sendMail(
                user.email,
                'Xác minh đổi mật khẩu',
                'change-password.template',
                {
                    username: user.username,
                    changeCode: code,
                }
            );

            return { message: 'Mã xác minh đã được gửi đến email của bạn' };
        } catch (error) {
            console.log(error);
            throw new InternalServerErrorException(
                'Gửi mã xác minh không thành công'
            );
        }
    }

    /**
     * Change password with verification code (for authenticated users)
     */
    async changePassword(
        user: User,
        code: string,
        currentPassword: string,
        newPassword: string
    ) {
        try {
            // Verify current password first
            if (user.password) {
                const isPasswordValid =
                    await this.passwordService.comparePasswords(
                        currentPassword,
                        user.password
                    );
                if (!isPasswordValid) {
                    throw new BadRequestException(
                        'Mật khẩu hiện tại không đúng'
                    );
                }
            }

            // Check verification code
            const resetCode = await this.prisma.resetPasswordCode.findUnique({
                where: { userId: user.id },
            });

            if (!resetCode) {
                throw new NotFoundException('Mã xác minh không hợp lệ');
            }

            if (resetCode.code !== code) {
                throw new BadRequestException('Mã xác minh không chính xác');
            }

            if (new Date() > resetCode.expiresAt) {
                throw new BadRequestException('Mã xác minh đã hết hạn');
            }

            // Update password
            await this.userRepository.update(
                user.id,
                {
                    password:
                        await this.passwordService.hashPassword(newPassword),
                },
                user.id
            );

            // Clean up code
            await this.prisma.resetPasswordCode.delete({
                where: { userId: user.id },
            });

            return { message: 'Mật khẩu đã được đổi thành công' };
        } catch (error) {
            if (
                error instanceof NotFoundException ||
                error instanceof BadRequestException
            ) {
                throw error;
            }
            throw new InternalServerErrorException(
                'Đổi mật khẩu không thành công'
            );
        }
    }

    private async handleOAuthLogin(
        email: string,
        username: string,
        avatar?: string,
        deviceInfo?: DeviceInfo
    ) {
        let existingUser = await this.userRepository.findByEmail(email, false);

        if (!existingUser) {
            // Create new user and wallet
            existingUser = await this.prisma.$transaction(async (tx) => {
                const user = await this.userRepository.create({
                    id: this.generateIdService.generateId(),
                    email,
                    username,
                    avatar,
                    isVerified: true,
                    password: null,
                });

                await tx.wallet.create({
                    data: {
                        id: this.generateIdService.generateId(),
                        userId: user.id,
                        balance: 20,
                    },
                });

                // Create default subscription (tier NONE)
                await tx.userSubscription.create({
                    data: {
                        id: this.generateIdService.generateId(),
                        userId: user.id,
                        tier: 0, // NONE
                        billingCycle: 'monthly',
                        isActive: false,
                    },
                });

                return user;
            });
        } else {
            // Check if wallet exists for existing user
            const walletExists = await this.prisma.wallet.findUnique({
                where: { userId: existingUser.id },
            });

            if (!walletExists) {
                await this.walletService.createWallet(existingUser);
            }
        }

        const token = this.jwtService.sign({ userId: existingUser.id });

        // Create session if deviceInfo provided
        let sessionId: string | undefined;
        if (deviceInfo) {
            sessionId = await this.createSession(existingUser.id, deviceInfo);
        }

        return {
            token,
            user: sanitizeUser(existingUser),
            success: true,
            sessionId,
            deviceId: deviceInfo?.deviceId,
        };
    }

    async googleLogin(user: any, deviceInfo?: DeviceInfo) {
        const { email, picture } = user;
        const username = email.split('@')[0];

        return this.handleOAuthLogin(email, username, picture, deviceInfo);
    }

    async facebookLogin(user: any, deviceInfo?: DeviceInfo) {
        const { email, picture, username } = user;

        if (!email) {
            throw new BadRequestException(
                'Tài khoản của bạn cần được liên kết với email để có thể hoàn tất đăng nhập.'
            );
        }

        return this.handleOAuthLogin(
            email,
            username || email.split('@')[0],
            picture,
            deviceInfo
        );
    }

    async githubLogin(user: any, deviceInfo?: DeviceInfo) {
        const { email, avatar, username } = user;

        return this.handleOAuthLogin(
            email,
            username || email.split('@')[0],
            avatar,
            deviceInfo
        );
    }

    async getUser(user: User) {
        const foundUser = await this.userRepository.findByIdWithRelations(
            user.id,
            ['wallet', 'subscription'],
            true
        );
        if (!foundUser) {
            throw new NotFoundException('Người dùng không tồn tại');
        }
        return { user: sanitizeUser(foundUser) };
    }

    // Session management
    async createSession(
        userId: string,
        deviceInfo: DeviceInfo
    ): Promise<string> {
        const sessionId = this.generateIdService.generateId();
        const { browser, os, deviceName } = this.parseUserAgent(
            deviceInfo.userAgent || ''
        );

        await this.userSessionRepository.create({
            id: this.generateIdService.generateId(),
            userId,
            sessionId,
            deviceId: deviceInfo.deviceId,
            deviceName,
            browser,
            os,
            ipAddress: deviceInfo.ipAddress || null,
            country: null, // Can be added with IP geolocation later
            city: null,
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        });

        return sessionId;
    }

    private parseUserAgent(userAgent: string): {
        browser: string | null;
        os: string | null;
        deviceName: string | null;
    } {
        if (!userAgent) return { browser: null, os: null, deviceName: null };

        // Simple User-Agent parsing
        let browser: string | null = null;
        let os: string | null = null;
        let deviceName: string | null = null;

        // Parse browser
        if (userAgent.includes('Chrome') && !userAgent.includes('Edg')) {
            const match = userAgent.match(/Chrome\/(\d+)/);
            browser = match ? `Chrome ${match[1]}` : 'Chrome';
        } else if (
            userAgent.includes('Safari') &&
            !userAgent.includes('Chrome')
        ) {
            const match = userAgent.match(/Version\/(\d+)/);
            browser = match ? `Safari ${match[1]}` : 'Safari';
        } else if (userAgent.includes('Firefox')) {
            const match = userAgent.match(/Firefox\/(\d+)/);
            browser = match ? `Firefox ${match[1]}` : 'Firefox';
        } else if (userAgent.includes('Edg')) {
            const match = userAgent.match(/Edg\/(\d+)/);
            browser = match ? `Edge ${match[1]}` : 'Edge';
        }

        // Parse OS
        if (userAgent.includes('Windows NT 10')) {
            os = 'Windows 10/11';
        } else if (userAgent.includes('Windows')) {
            os = 'Windows';
        } else if (userAgent.includes('Mac OS X')) {
            const match = userAgent.match(/Mac OS X (\d+[._]\d+)/);
            os = match ? `macOS ${match[1].replace('_', '.')}` : 'macOS';
        } else if (userAgent.includes('Linux')) {
            os = 'Linux';
        } else if (userAgent.includes('Android')) {
            const match = userAgent.match(/Android (\d+)/);
            os = match ? `Android ${match[1]}` : 'Android';
        } else if (userAgent.includes('iPhone') || userAgent.includes('iPad')) {
            const match = userAgent.match(/OS (\d+)/);
            os = match ? `iOS ${match[1]}` : 'iOS';
        }

        // Device name based on OS
        if (userAgent.includes('iPhone')) {
            deviceName = 'iPhone';
        } else if (userAgent.includes('iPad')) {
            deviceName = 'iPad';
        } else if (userAgent.includes('Android')) {
            deviceName = 'Android Device';
        } else if (userAgent.includes('Macintosh')) {
            deviceName = 'Mac';
        } else if (userAgent.includes('Windows')) {
            deviceName = 'PC';
        } else if (userAgent.includes('Linux')) {
            deviceName = 'Linux PC';
        }

        return { browser, os, deviceName };
    }
}
