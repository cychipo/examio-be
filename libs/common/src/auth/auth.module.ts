import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthGuard } from '../guard/auth.guard';
import { OptionalAuthGuard } from '../guard/optional-auth.guard';
import { DatabaseModule } from '@examio/database';

/**
 * AuthModule - Provides JWT and Auth Guards for microservices
 * Import this module in any module that needs AuthGuard
 */
@Module({
    imports: [
        DatabaseModule,
        JwtModule.register({
            secret: process.env.JWT_SECRET,
            signOptions: { expiresIn: '7d' },
        }),
    ],
    providers: [AuthGuard, OptionalAuthGuard],
    exports: [JwtModule, AuthGuard, OptionalAuthGuard],
})
export class AuthModule {}
