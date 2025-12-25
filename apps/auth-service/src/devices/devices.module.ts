import { Module } from '@nestjs/common';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { UserSessionRepository } from './repositories/user-session.repository';
import { PrismaService } from 'src/prisma/prisma.service';
import { JwtModule } from '@nestjs/jwt';
import { SessionCleanupCron } from './session-cleanup.cron';

@Module({
    imports: [
        JwtModule.register({
            secret: process.env.JWT_SECRET,
            signOptions: { expiresIn: '7d' },
        }),
    ],
    controllers: [DevicesController],
    providers: [
        PrismaService,
        DevicesService,
        UserSessionRepository,
        SessionCleanupCron,
    ],
    exports: [UserSessionRepository],
})
export class DevicesModule {}
