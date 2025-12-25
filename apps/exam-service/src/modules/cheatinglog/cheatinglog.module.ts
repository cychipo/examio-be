import { Module } from '@nestjs/common';
import { CheatingLogController } from './cheatinglog.controller';
import { CheatingLogService } from './cheatinglog.service';
import { CheatingLogRepository } from './cheatinglog.repository';
import { PrismaService } from '@examio/database';
import { AuthGuard } from '@examio/common';

@Module({
    controllers: [CheatingLogController],
    providers: [
        CheatingLogService,
        CheatingLogRepository,
        PrismaService,
        AuthGuard,
    ],
    exports: [CheatingLogService, CheatingLogRepository],
})
export class CheatingLogModule {}
