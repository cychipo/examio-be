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

@Injectable()
export class AuthService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly jwtService: JwtService,
        private readonly mailService: MailService,
        private readonly passwordService: PasswordService,
        private readonly generateIdService: GenerateIdService,
        private readonly walletService: WalletService
    ) {}

    async login(loginDto: LoginDto) {
        const { credential, password } = loginDto;
        if (!credential || !password) {
            throw new BadRequestException('Thông tin đăng nhập không hợp lệ');
        }
        try {
            // Validate user credentials
            const user = await this.prisma.user.findFirst({
                where: {
                    OR: [{ email: credential }, { username: credential }],
                },
            });
            if (!user) {
                throw new NotFoundException('Không tìm thấy người dùng');
            }
            // Check password (assuming bcrypt is used for hashing)
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

            return { token, user: sanitizeUser(user), success: true };
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
            // check valid email and username
            const [existingEmail, existingUsername] = await Promise.all([
                this.prisma.user.findUnique({
                    where: { email: email.toLowerCase() },
                }),
                this.prisma.user.findUnique({
                    where: { username: username.toLowerCase() },
                }),
            ]);

            if (existingEmail) {
                throw new ConflictException('Email đã được sử dụng');
            }

            if (existingUsername) {
                throw new ConflictException('Username đã được sử dụng');
            }

            // Hash the password
            const hashedPassword =
                await this.passwordService.hashPassword(password);

            // Create new user
            const newUser = await this.prisma.$transaction(async (tx) => {
                const user = await tx.user.create({
                    data: {
                        id: this.generateIdService.generateId(),
                        username,
                        email,
                        password: hashedPassword,
                    },
                });

                await tx.wallet.create({
                    data: {
                        id: this.generateIdService.generateId(),
                        userId: user.id,
                        balance: 20,
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
            const code = generateCode(6);

            await this.prisma.verifyAccountCode.create({
                data: {
                    id: this.generateIdService.generateId(),
                    userId: user.id,
                    code,
                    expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
                },
            });

            // Send verification email
            await this.mailService.sendMail(
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

            if (!verificationCode) {
                throw new NotFoundException('Mã xác minh không hợp lệ');
            }

            if (verificationCode.code !== code) {
                throw new BadRequestException('Mã xác minh không chính xác');
            }

            if (new Date() > verificationCode.expiresAt) {
                throw new BadRequestException('Mã xác minh đã hết hạn');
            }

            // Mark user as verified
            await this.prisma.user.update({
                where: { id: userId },
                data: { isVerified: true },
            });

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
            const user = await this.prisma.user.findFirst({
                where: { email: email },
            });

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
            await this.mailService.sendMail(
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
            const user = await this.prisma.user.findUnique({
                where: { email: email.toLowerCase() },
            });

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

            // Update user password
            await this.prisma.user.update({
                where: { id: user.id },
                data: {
                    password:
                        await this.passwordService.hashPassword(newPassword),
                },
            });

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

    private async handleOAuthLogin(
        email: string,
        username: string,
        avatar?: string
    ) {
        let existingUser = await this.prisma.user.findUnique({
            where: { email },
        });

        if (!existingUser) {
            existingUser = await this.prisma.$transaction(async (tx) => {
                const user = await tx.user.create({
                    data: {
                        id: this.generateIdService.generateId(),
                        email,
                        username,
                        avatar,
                        isVerified: true,
                        password: null,
                    },
                });

                await tx.wallet.create({
                    data: {
                        id: this.generateIdService.generateId(),
                        userId: user.id,
                        balance: 0,
                    },
                });

                return user;
            });
        } else {
            const walletExists = await this.prisma.wallet.findUnique({
                where: { userId: existingUser.id },
            });

            if (!walletExists) {
                await this.walletService.createWallet(existingUser);
            }
        }

        const token = this.jwtService.sign({ userId: existingUser.id });

        return {
            token,
            user: sanitizeUser(existingUser),
            success: true,
        };
    }

    async googleLogin(user: any) {
        const { email, picture } = user;
        const username = email.split('@')[0];

        return this.handleOAuthLogin(email, username, picture);
    }

    async facebookLogin(user: any) {
        const { email, picture, username } = user;

        if (!email) {
            throw new BadRequestException(
                'Tài khoản của bạn cần được liên kết với email để có thể hoàn tất đăng nhập.'
            );
        }

        return this.handleOAuthLogin(
            email,
            username || email.split('@')[0],
            picture
        );
    }

    async githubLogin(user: any) {
        const { email, avatar, username } = user;

        return this.handleOAuthLogin(
            email,
            username || email.split('@')[0],
            avatar
        );
    }

    async getUser(user: User) {
        const foundUser = await this.prisma.user.findUnique({
            where: { id: user.id },
            include: {
                wallet: {
                    select: { balance: true },
                },
            },
        });
        if (!foundUser) {
            throw new NotFoundException('Người dùng không tồn tại');
        }
        return { user: sanitizeUser(foundUser) };
    }
}
