import { Module } from '@nestjs/common';
import { PrismaService } from '@examio/database';
import { AuthModule } from '@examio/common';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { UserSessionRepository } from './repositories/user-session.repository';

@Module({
    imports: [AuthModule],
    controllers: [DevicesController],
    providers: [DevicesService, PrismaService, UserSessionRepository],
    exports: [DevicesService, UserSessionRepository],
})
export class DevicesModule {}
