import { Module } from '@nestjs/common';
import { DatabaseModule, PrismaService } from '@examio/database';
import { RedisModule, RedisService } from '@examio/redis';
import {
    GenerateIdService,
    CryptoService,
    GrpcClientsModule,
    EventsModule,
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
import { AIModule } from './modules/ai/ai.module';
import { AIChatModule } from './modules/ai-chat/ai-chat.module';
import { FinanceClientModule } from './modules/finance-client/finance-client.module';

@Module({
    imports: [
        DatabaseModule,
        RedisModule,
        EventsModule,
        GrpcClientsModule.registerR2Client(),
        FinanceClientModule,
        QuizsetModule,
        QuizPracticeAttemptModule,
        ExamRoomModule,
        ExamSessionModule,
        ExamAttemptModule,
        CheatingLogModule,
        FlashcardSetModule,
        AIModule,
        AIChatModule,
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
