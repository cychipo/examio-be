import { Module, forwardRef } from '@nestjs/common';
import { QuizsetService } from './quizset.service';
import { QuizsetController } from './quizset.controller';
import { PrismaService } from '@examio/database';
import {
    GenerateIdService,
    AuthModule,
    GrpcClientsModule,
    R2ClientService,
} from '@examio/common';
import { RedisService } from '@examio/redis';
import { QuizSetRepository } from './quizset.repository';
import { QuizPracticeAttemptRepository } from '../quizpracticeattempt/quiz-practice-attempt.repository';

@Module({
    imports: [AuthModule, GrpcClientsModule.registerR2Client()],
    providers: [
        PrismaService,
        RedisService,
        QuizsetService,
        GenerateIdService,
        R2ClientService,
        QuizSetRepository,
        QuizPracticeAttemptRepository,
    ],
    controllers: [QuizsetController],
    exports: [QuizsetService, QuizSetRepository],
})
export class QuizsetModule {}
