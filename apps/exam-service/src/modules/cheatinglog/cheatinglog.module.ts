import { Module } from '@nestjs/common';
import { CheatingLogController } from './cheatinglog.controller';
import { CheatingLogService } from './cheatinglog.service';
import { CheatingLogRepository } from './cheatinglog.repository';
import { PrismaService } from '@examio/database';
import { AuthModule } from '@examio/common';

@Module({
    imports: [AuthModule],
    controllers: [CheatingLogController],
    providers: [CheatingLogService, CheatingLogRepository, PrismaService],
    exports: [CheatingLogService, CheatingLogRepository],
})
export class CheatingLogModule {}
