import { Module } from '@nestjs/common';
import { DatabaseModule, PrismaService } from '@examio/database';
import { RedisModule, RedisService } from '@examio/redis';
import {
    GenerateIdService,
    CryptoService,
    GrpcClientsModule,
} from '@examio/common';
import { ExamServiceController } from './exam-service.controller';
import { ExamServiceService } from './exam-service.service';

// Import sub-modules
import { QuizsetModule } from './modules/quizset/quizset.module';
import { QuizPracticeAttemptModule } from './modules/quizpracticeattempt/quiz-practice-attempt.module';
import { ExamRoomModule } from './modules/examroom/examroom.module';
import { ExamSessionModule } from './modules/examsession/examsession.module';
import { ExamAttemptModule } from './modules/examattempt/examattempt.module';
import { CheatingLogModule } from './modules/cheatinglog/cheatinglog.module';
import { FlashcardSetModule } from './modules/flashcardset/flashcardset.module';

@Module({
    imports: [
        DatabaseModule,
        RedisModule,
        GrpcClientsModule.registerR2Client(),
        QuizsetModule,
        QuizPracticeAttemptModule,
        ExamRoomModule,
        ExamSessionModule,
        ExamAttemptModule,
        CheatingLogModule,
        FlashcardSetModule,
    ],
    controllers: [ExamServiceController],
    providers: [
        ExamServiceService,
        PrismaService,
        RedisService,
        GenerateIdService,
        CryptoService,
    ],
})
export class ExamServiceModule {}
