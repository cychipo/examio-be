import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

// Shared libs
import { DatabaseModule, PrismaService } from '@examio/database';
import {
    MailService,
    PasswordService,
    GenerateIdService,
    AuthGuard,
    GrpcClientsModule,
} from '@examio/common';
import { RedisModule, RedisService } from '@examio/redis';

// Local imports
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { GoogleStrategy } from './strategies/google.strategy';
import { FacebookStrategy } from './strategies/facebook.strategy';
import { GithubStrategy } from './strategies/github.strategy';
import { UserRepository } from './repositories/user.repository';
import { DevicesModule } from './devices/devices.module';
import { ProfileModule } from './profile/profile.module';

@Module({
    imports: [
        DatabaseModule,
        RedisModule,
        GrpcClientsModule.registerWalletClient(),
        JwtModule.register({
            secret: process.env.JWT_SECRET,
            signOptions: { expiresIn: '30d' },
        }),
        PassportModule.register({ session: true }),
        DevicesModule,
        ProfileModule,
    ],
    providers: [
        PrismaService,
        RedisService,
        PasswordService,
        GenerateIdService,
        GoogleStrategy,
        FacebookStrategy,
        GithubStrategy,
        AuthService,
        MailService,
        AuthGuard,
        UserRepository,
    ],
    controllers: [AuthController],
    exports: [AuthService, JwtModule, AuthGuard, UserRepository],
})
export class AuthModule {}
