import { Module } from '@nestjs/common';
import { QuizPracticeAttemptService } from './quiz-practice-attempt.service';
import { QuizPracticeAttemptController } from './quiz-practice-attempt.controller';
import { QuizPracticeAttemptRepository } from './quiz-practice-attempt.repository';
import { PrismaService } from '@examio/database';
import { GenerateIdService, AuthModule } from '@examio/common';
import { RedisService } from '@examio/redis';
import { QuizsetModule } from '../quizset/quizset.module';

@Module({
    imports: [AuthModule, QuizsetModule],
    providers: [
        PrismaService,
        RedisService,
        QuizPracticeAttemptService,
        QuizPracticeAttemptRepository,
        GenerateIdService,
    ],
    controllers: [QuizPracticeAttemptController],
    exports: [QuizPracticeAttemptService, QuizPracticeAttemptRepository],
})
export class QuizPracticeAttemptModule {}
