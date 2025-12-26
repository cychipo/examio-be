import { Module } from '@nestjs/common';
import { QuizsetModule } from './modules/quizset/quizset.module';
import { FlashcardSetModule } from './modules/flashcardset/flashcardset.module';
import { ExamRoomModule } from './modules/examroom/examroom.module';
import { ExamSessionModule } from './modules/examsession/examsession.module';
import { ExamAttemptModule } from './modules/examattempt/examattempt.module';
import { QuizPracticeAttemptModule } from './modules/quizpracticeattempt/quiz-practice-attempt.module';
import { CheatingLogModule } from './modules/cheatinglog/cheatinglog.module';

@Module({
    imports: [
        QuizsetModule,
        FlashcardSetModule,
        ExamRoomModule,
        ExamSessionModule,
        ExamAttemptModule,
        QuizPracticeAttemptModule,
        CheatingLogModule,
    ],
    exports: [
        QuizsetModule,
        FlashcardSetModule,
        ExamRoomModule,
        ExamSessionModule,
        ExamAttemptModule,
        QuizPracticeAttemptModule,
        CheatingLogModule,
    ],
})
export class ExamModule {}
