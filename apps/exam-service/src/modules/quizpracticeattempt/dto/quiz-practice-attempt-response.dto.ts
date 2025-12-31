import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class QuizPracticeAttemptDto {
    @ApiProperty()
    id: string;

    @ApiProperty()
    quizSetId: string;

    @ApiProperty()
    userId: string;

    @ApiProperty({ description: '0: PRACTICE, 1: REAL' })
    type: number;

    @ApiProperty({ description: '{ questionId: selectedAnswer }' })
    answers: Record<string, string>;

    @ApiProperty()
    currentIndex: number;

    @ApiProperty()
    markedQuestions: string[];

    @ApiProperty()
    timeSpentSeconds: number;

    @ApiPropertyOptional()
    timeLimitMinutes: number | null;

    @ApiProperty()
    isSubmitted: boolean;

    @ApiPropertyOptional()
    score: number | null;

    @ApiProperty()
    totalQuestions: number;

    @ApiProperty()
    correctAnswers: number;

    @ApiProperty()
    startedAt: Date;

    @ApiPropertyOptional()
    submittedAt: Date | null;

    @ApiProperty()
    createdAt: Date;

    @ApiProperty()
    updatedAt: Date;
}

export class GetOrCreateAttemptResponseDto {
    @ApiProperty()
    attempt: QuizPracticeAttemptDto;

    @ApiProperty({ description: 'true nếu là bản ghi mới được tạo' })
    isNew: boolean;
}

export class SubmitAttemptResponseDto {
    @ApiProperty()
    message: string;

    @ApiProperty()
    attempt: QuizPracticeAttemptDto;

    @ApiProperty()
    score: number;

    @ApiProperty()
    totalQuestions: number;

    @ApiProperty()
    correctAnswers: number;

    @ApiProperty()
    percentage: number;
}

export class ResetAttemptResponseDto {
    @ApiProperty()
    message: string;

    @ApiProperty()
    attempt: QuizPracticeAttemptDto;
}
