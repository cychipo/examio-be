import { Module } from '@nestjs/common';
import { QuizsetModule } from './modules/quizset/quizset.module';
import { FlashcardsetModule } from './modules/flashcardset/flashcardset.module';
import { ExamRoomModule } from './modules/examroom/examroom.module';
import { ExamSessionModule } from './modules/examsession/examsession.module';
import { ExamAttemptModule } from './modules/examattempt/examattempt.module';
import { QuizPracticeAttemptModule } from './modules/quizpracticeattempt/quiz-practice-attempt.module';

@Module({
    imports: [
        QuizsetModule,
        FlashcardsetModule,
        ExamRoomModule,
        ExamSessionModule,
        ExamAttemptModule,
        QuizPracticeAttemptModule,
    ],
    exports: [
        QuizsetModule,
        FlashcardsetModule,
        ExamRoomModule,
        ExamSessionModule,
        ExamAttemptModule,
        QuizPracticeAttemptModule,
    ],
})
export class ExamModule {}
