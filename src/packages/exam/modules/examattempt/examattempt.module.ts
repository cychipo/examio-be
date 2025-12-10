import { Module } from '@nestjs/common';
import { ExamAttemptService } from './examattempt.service';
import { ExamAttemptController } from './examattempt.controller';
import { PrismaService } from 'src/prisma/prisma.service';
import { GenerateIdService } from 'src/common/services/generate-id.service';
import { CryptoService } from 'src/common/services/crypto.service';
import { AuthModule } from 'src/packages/auth/auth.module';
import { AuthGuard } from 'src/common/guard/auth.guard';
import { ExamAttemptRepository } from './examattempt.repository';
import { ExamSessionRepository } from '../examsession/examsession.repository';
import { RedisModule } from 'src/packages/redis/redis.module';

@Module({
    imports: [AuthModule, RedisModule],
    providers: [
        PrismaService,
        ExamAttemptService,
        GenerateIdService,
        CryptoService,
        AuthGuard,
        ExamAttemptRepository,
        ExamSessionRepository,
    ],
    controllers: [ExamAttemptController],
    exports: [ExamAttemptService, ExamAttemptRepository],
})
export class ExamAttemptModule {}
