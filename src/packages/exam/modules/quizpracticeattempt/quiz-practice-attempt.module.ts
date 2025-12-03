import { Module } from '@nestjs/common';
import { QuizPracticeAttemptService } from './quiz-practice-attempt.service';
import { QuizPracticeAttemptController } from './quiz-practice-attempt.controller';
import { QuizPracticeAttemptRepository } from './quiz-practice-attempt.repository';
import { PrismaService } from 'src/prisma/prisma.service';
import { GenerateIdService } from 'src/common/services/generate-id.service';
import { AuthModule } from 'src/packages/auth/auth.module';
import { AuthGuard } from 'src/common/guard/auth.guard';
import { QuizsetModule } from '../quizset/quizset.module';

@Module({
    imports: [AuthModule, QuizsetModule],
    providers: [
        PrismaService,
        QuizPracticeAttemptService,
        QuizPracticeAttemptRepository,
        GenerateIdService,
        AuthGuard,
    ],
    controllers: [QuizPracticeAttemptController],
    exports: [QuizPracticeAttemptService, QuizPracticeAttemptRepository],
})
export class QuizPracticeAttemptModule {}
