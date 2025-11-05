import { Module } from '@nestjs/common';
import { QuizsetService } from './quizset.service';
import { QuizsetController } from './quizset.controller';
import { PrismaService } from 'src/prisma/prisma.service';
import { GenerateIdService } from 'src/common/services/generate-id.service';
import { AuthModule } from 'src/packages/auth/auth.module';
import { AuthGuard } from 'src/common/guard/auth.guard';
import { QuizSetRepository } from './quizset.repository';

@Module({
    imports: [AuthModule],
    providers: [
        PrismaService,
        QuizsetService,
        GenerateIdService,
        AuthGuard,
        QuizSetRepository,
    ],
    controllers: [QuizsetController],
    exports: [QuizsetService, QuizSetRepository],
})
export class QuizsetModule {}
