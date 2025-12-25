import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaService } from '@examio/database';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { UserSessionRepository } from './repositories/user-session.repository';

@Module({
    imports: [
        JwtModule.register({
            secret: process.env.JWT_SECRET,
            signOptions: { expiresIn: '30d' },
        }),
    ],
    controllers: [DevicesController],
    providers: [DevicesService, PrismaService, UserSessionRepository],
    exports: [DevicesService, UserSessionRepository],
})
export class DevicesModule {}
