import { Module } from '@nestjs/common';
import { ExamAttemptService } from './examattempt.service';
import { ExamAttemptController } from './examattempt.controller';
import { PrismaService } from 'src/prisma/prisma.service';
import { GenerateIdService } from 'src/common/services/generate-id.service';
import { AuthModule } from 'src/packages/auth/auth.module';
import { AuthGuard } from 'src/common/guard/auth.guard';

@Module({
    imports: [AuthModule],
    providers: [
        PrismaService,
        ExamAttemptService,
        GenerateIdService,
        AuthGuard,
    ],
    controllers: [ExamAttemptController],
    exports: [ExamAttemptService],
})
export class ExamAttemptModule {}
