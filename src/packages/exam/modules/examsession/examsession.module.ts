import { Module } from '@nestjs/common';
import { ExamSessionService } from './examsession.service';
import { ExamSessionController } from './examsession.controller';
import { PrismaService } from 'src/prisma/prisma.service';
import { GenerateIdService } from 'src/common/services/generate-id.service';
import { AuthModule } from 'src/packages/auth/auth.module';
import { AuthGuard } from 'src/common/guard/auth.guard';

@Module({
    imports: [AuthModule],
    providers: [
        PrismaService,
        ExamSessionService,
        GenerateIdService,
        AuthGuard,
    ],
    controllers: [ExamSessionController],
    exports: [ExamSessionService],
})
export class ExamSessionModule {}
