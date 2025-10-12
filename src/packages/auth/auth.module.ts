import { Module } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { MailService } from 'src/common/services/mail.service';
import { PasswordService } from 'src/common/services/password.service';
import { GenerateIdService } from 'src/common/services/generate-id.service';
import { AuthGuard } from 'src/common/guard/auth.guard';
import { PassportModule } from '@nestjs/passport';
import { GoogleStrategy } from './strategies/google.strategy';
import { FacebookStrategy } from './strategies/facebook.strategy';
import { GithubStrategy } from './strategies/github.strategy';
import { WalletService } from '../finance/modules/wallet/wallet.service';

@Module({
    imports: [
        JwtModule.register({
            secret: process.env.JWT_SECRET,
            signOptions: { expiresIn: '30d' },
        }),
        PassportModule.register({ session: true }),
    ],
    providers: [
        PrismaService,
        PasswordService,
        GenerateIdService,
        GoogleStrategy,
        FacebookStrategy,
        GithubStrategy,
        AuthService,
        MailService,
        AuthGuard,
        WalletService,
    ],
    controllers: [AuthController],
    exports: [AuthService, JwtModule, AuthGuard, JwtModule],
})
export class AuthModule {}
