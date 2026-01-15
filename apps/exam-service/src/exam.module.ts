import { Module } from '@nestjs/common';
import { QuizsetModule } from './modules/quizset/quizset.module';
import { FlashcardSetModule } from './modules/flashcardset/flashcardset.module';
import { ExamRoomModule } from './modules/examroom/examroom.module';
import { ExamSessionModule } from './modules/examsession/examsession.module';
import { ExamAttemptModule } from './modules/examattempt/examattempt.module';
import { CheatingLogModule } from './modules/cheatinglog/cheatinglog.module';
import { SubjectModule } from './modules/subject/subject.module';

@Module({
    imports: [
        QuizsetModule,
        FlashcardSetModule,
        ExamRoomModule,
        ExamSessionModule,
        ExamAttemptModule,
        CheatingLogModule,
        SubjectModule,
    ],
    exports: [
        QuizsetModule,
        FlashcardSetModule,
        ExamRoomModule,
        ExamSessionModule,
        ExamAttemptModule,
        CheatingLogModule,
        SubjectModule,
    ],
})
export class ExamModule {}
