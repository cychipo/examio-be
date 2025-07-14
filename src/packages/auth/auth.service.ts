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

@Injectable()
export class AuthService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly jwtService: JwtService,
        private readonly mailService: MailService,
        private readonly passwordService: PasswordService,
        private readonly generateIdService: GenerateIdService
    ) {}

    async login(loginDto: LoginDto) {
        const { credential, password } = loginDto;

        try {
            // Validate user credentials
            const user = await this.prisma.user.findFirst({
                where: {
                    OR: [{ email: credential }, { username: credential }],
                },
            });

            if (!user) {
                throw new NotFoundException('User not found');
            }

            // Check password (assuming bcrypt is used for hashing)
            const isPasswordValid = await this.passwordService.comparePasswords(
                password,
                user.password
            );
            if (!isPasswordValid) {
                throw new BadRequestException('Invalid credentials');
            }

            // Generate JWT token
            const token = this.jwtService.sign({ userId: user.id });

            return { token, user: sanitizeUser(user) };
        } catch (error) {
            if (
                error instanceof NotFoundException ||
                error instanceof BadRequestException
            ) {
                throw error;
            }
            throw new InternalServerErrorException('Login failed');
        }
    }

    async register(registerDto: RegisterDto) {
        const { username, email, password } = registerDto;

        try {
            // Check if user already exists
            const existingUser = await this.prisma.user.findUnique({
                where: { email: email.toLowerCase() },
            });

            if (existingUser) {
                throw new ConflictException('Email already in use');
            }

            // Check if username already exists
            const existingUsername = await this.prisma.user.findUnique({
                where: { username: username.toLowerCase() },
            });
            if (existingUsername) {
                throw new ConflictException('Username already in use');
            }

            // Hash the password
            const hashedPassword =
                await this.passwordService.hashPassword(password);

            // Create new user
            const newUser = await this.prisma.user.create({
                data: {
                    id: this.generateIdService.generateId(),
                    username,
                    email,
                    password: hashedPassword,
                },
            });

            // Send welcome email
            await this.mailService.sendMail(
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
                message: 'User registered successfully',
                user: sanitizeUser(newUser),
            };
        } catch (error) {
            if (error instanceof ConflictException) {
                throw error;
            }
            throw new InternalServerErrorException('Registration failed');
        }
    }
}
