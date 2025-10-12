import { Module } from '@nestjs/common';
import { QuizsetModule } from './modules/quizset/quizset.module';
import { FlashcardsetModule } from './modules/flashcardset/flashcardset.module';
import { ExamRoomModule } from './modules/examroom/examroom.module';
import { ExamSessionModule } from './modules/examsession/examsession.module';
import { ExamAttemptModule } from './modules/examattempt/examattempt.module';
import { ParticipantModule } from './modules/participant/participant.module';

@Module({
    imports: [
        QuizsetModule,
        FlashcardsetModule,
        ExamRoomModule,
        ExamSessionModule,
        ExamAttemptModule,
        ParticipantModule,
    ],
    exports: [
        QuizsetModule,
        FlashcardsetModule,
        ExamRoomModule,
        ExamSessionModule,
        ExamAttemptModule,
        ParticipantModule,
    ],
})
export class ExamModule {}
