import { Module } from '@nestjs/common';
import { CheatingLogController } from './cheatinglog.controller';
import { CheatingLogService } from './cheatinglog.service';
import { CheatingLogRepository } from './cheatinglog.repository';
import { PrismaService } from 'src/prisma/prisma.service';
import { AuthModule } from 'src/packages/auth/auth.module';
import { AuthGuard } from 'src/common/guard/auth.guard';

@Module({
    imports: [AuthModule],
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
