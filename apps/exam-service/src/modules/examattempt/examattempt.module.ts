import { Module } from '@nestjs/common';
import { ExamAttemptService } from './examattempt.service';
import { ExamAttemptController } from './examattempt.controller';
import { PrismaService } from '@examio/database';
import { GenerateIdService, CryptoService, AuthModule } from '@examio/common';
import { RedisModule, RedisService } from '@examio/redis';
import { ExamAttemptRepository } from './examattempt.repository';
import { ExamSessionRepository } from '../examsession/examsession.repository';

@Module({
    imports: [AuthModule, RedisModule],
    providers: [
        PrismaService,
        RedisService,
        ExamAttemptService,
        GenerateIdService,
        CryptoService,
        ExamAttemptRepository,
        ExamSessionRepository,
    ],
    controllers: [ExamAttemptController],
    exports: [ExamAttemptService, ExamAttemptRepository],
})
export class ExamAttemptModule {}
