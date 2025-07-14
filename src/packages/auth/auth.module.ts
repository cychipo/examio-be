import { Module } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtModule } from '@nestjs/jwt';
import { MailService } from 'src/common/services/mail.service';
import { PasswordService } from 'src/common/services/password.service';
import { GenerateIdService } from 'src/common/services/generate-id.service';

@Module({
    imports: [
        JwtModule.register({
            secret: process.env.JWT_SECRET,
            signOptions: { expiresIn: '30d' },
        }),
    ],
    providers: [
        PrismaService,
        PasswordService,
        GenerateIdService,
        AuthService,
        MailService,
    ],
    controllers: [AuthController],
    exports: [AuthService, JwtModule],
})
export class AuthModule {}
