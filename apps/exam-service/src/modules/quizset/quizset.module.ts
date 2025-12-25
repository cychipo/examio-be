import { Module, forwardRef } from '@nestjs/common';
import { QuizsetService } from './quizset.service';
import { QuizsetController } from './quizset.controller';
import { PrismaService } from '@examio/database';
import {
    GenerateIdService,
    AuthGuard,
    GrpcClientsModule,
} from '@examio/common';
import { RedisService } from '@examio/redis';
import { QuizSetRepository } from './quizset.repository';
import { QuizPracticeAttemptRepository } from '../quizpracticeattempt/quiz-practice-attempt.repository';

@Module({
    imports: [GrpcClientsModule.registerR2Client()],
    providers: [
        PrismaService,
        RedisService,
        QuizsetService,
        GenerateIdService,
        AuthGuard,
        QuizSetRepository,
        QuizPracticeAttemptRepository,
    ],
    controllers: [QuizsetController],
    exports: [QuizsetService, QuizSetRepository],
})
export class QuizsetModule {}
