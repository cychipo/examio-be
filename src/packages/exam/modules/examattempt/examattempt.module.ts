import { Module } from '@nestjs/common';
import { ExamAttemptService } from './examattempt.service';
import { ExamAttemptController } from './examattempt.controller';
import { PrismaService } from 'src/prisma/prisma.service';
import { GenerateIdService } from 'src/common/services/generate-id.service';
import { AuthModule } from 'src/packages/auth/auth.module';
import { AuthGuard } from 'src/common/guard/auth.guard';
import { ExamAttemptRepository } from './examattempt.repository';
import { ExamSessionRepository } from '../examsession/examsession.repository';

@Module({
    imports: [AuthModule],
    providers: [
        PrismaService,
        ExamAttemptService,
        GenerateIdService,
        AuthGuard,
        ExamAttemptRepository,
        ExamSessionRepository,
    ],
    controllers: [ExamAttemptController],
    exports: [ExamAttemptService, ExamAttemptRepository],
})
export class ExamAttemptModule {}
