import { PrismaService } from '@examio/database';
import {
    Injectable,
    NotFoundException,
    InternalServerErrorException,
} from '@nestjs/common';
import { GenerateIdService } from '@examio/common';
import { User } from '@prisma/client';
import { QUIZ_PRACTICE_TYPE } from '../../types';
import { CreateQuizPracticeAttemptDto } from './dto/create-quiz-practice-attempt.dto';
import { UpdateQuizPracticeAttemptDto } from './dto/update-quiz-practice-attempt.dto';
import { QuizPracticeAttemptRepository } from './quiz-practice-attempt.repository';
import { QuizSetRepository } from '../quizset/quizset.repository';

@Injectable()
export class QuizPracticeAttemptService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly attemptRepository: QuizPracticeAttemptRepository,
        private readonly quizSetRepository: QuizSetRepository,
        private readonly generateIdService: GenerateIdService
    ) {}

    /**
     * Lấy hoặc tạo attempt cho user
     * Nếu đã có attempt chưa submit -> trả về
     * Nếu đã submit -> phải gọi reset trước khi làm lại
     */
    async getOrCreateAttempt(user: User, dto: CreateQuizPracticeAttemptDto) {
        const type = dto.type ?? QUIZ_PRACTICE_TYPE.PRACTICE;

        // Kiểm tra quizSet có tồn tại không
        const quizSet = await this.quizSetRepository.findOne({
            where: { id: dto.quizSetId },
            include: {
                detailsQuizQuestions: {
                    select: { id: true },
                },
            },
            cache: true,
        });

        if (!quizSet) {
            throw new NotFoundException('Bộ đề thi không tồn tại');
        }

        // Tìm attempt hiện có - O(1) lookup với unique constraint
        const existingAttempt =
            await this.attemptRepository.findByUserQuizSetAndType(
                user.id,
                dto.quizSetId,
                type,
                true
            );

        if (existingAttempt) {
            return {
                attempt: existingAttempt,
                isNew: false,
            };
        }

        // Tạo attempt mới
        try {
            const totalQuestions =
                (quizSet as any).detailsQuizQuestions?.length || 0;

            const newAttempt = await this.attemptRepository.create(
                {
                    id: this.generateIdService.generateId(),
                    quizSetId: dto.quizSetId,
                    userId: user.id,
                    type,
                    answers: {},
                    currentIndex: 0,
                    markedQuestions: [],
                    timeSpentSeconds: 0,
                    timeLimitMinutes: dto.timeLimitMinutes ?? null,
                    isSubmitted: false,
                    score: null,
                    totalQuestions,
                    correctAnswers: 0,
                    startedAt: new Date(),
                    submittedAt: null,
                },
                user.id
            );

            return {
                attempt: newAttempt,
                isNew: true,
            };
        } catch (error) {
            // Race condition: nếu attempt đã được tạo bởi request khác
            const existingAfterError =
                await this.attemptRepository.findByUserQuizSetAndType(
                    user.id,
                    dto.quizSetId,
                    type,
                    false
                );

            if (existingAfterError) {
                return {
                    attempt: existingAfterError,
                    isNew: false,
                };
            }

            throw new InternalServerErrorException(
                'Tạo phiên làm bài thất bại'
            );
        }
    }

    /**
     * Cập nhật attempt (answers, currentIndex, timeSpent, etc.)
     * Dùng cho debounced auto-save
     */
    async updateAttempt(
        attemptId: string,
        user: User,
        dto: UpdateQuizPracticeAttemptDto
    ) {
        // Verify ownership
        const attempt = await this.attemptRepository.findOne({
            where: { id: attemptId, userId: user.id },
            cache: false,
        });

        if (!attempt) {
            throw new NotFoundException('Phiên làm bài không tồn tại');
        }

        if ((attempt as any).isSubmitted) {
            throw new NotFoundException(
                'Phiên làm bài đã nộp, không thể cập nhật'
            );
        }

        try {
            const updateData: any = {};

            if (dto.answers !== undefined) {
                updateData.answers = dto.answers;
            }
            if (dto.currentIndex !== undefined) {
                updateData.currentIndex = dto.currentIndex;
            }
            if (dto.markedQuestions !== undefined) {
                updateData.markedQuestions = dto.markedQuestions;
            }
            if (dto.timeSpentSeconds !== undefined) {
                updateData.timeSpentSeconds = dto.timeSpentSeconds;
            }
            if (dto.timeLimitMinutes !== undefined) {
                updateData.timeLimitMinutes = dto.timeLimitMinutes;
            }

            const updatedAttempt = await this.attemptRepository.update(
                attemptId,
                updateData,
                user.id
            );

            return {
                message: 'Cập nhật phiên làm bài thành công',
                attempt: updatedAttempt,
            };
        } catch (error) {
            throw new InternalServerErrorException(
                'Cập nhật phiên làm bài thất bại'
            );
        }
    }

    /**
     * Nộp bài - tính điểm và đánh dấu isSubmitted = true
     */
    async submitAttempt(attemptId: string, user: User) {
        // Lấy attempt với thông tin quizSet và questions
        const attempt = await this.attemptRepository.findOne({
            where: { id: attemptId, userId: user.id },
            cache: false,
        });

        if (!attempt) {
            throw new NotFoundException('Phiên làm bài không tồn tại');
        }

        if ((attempt as any).isSubmitted) {
            throw new NotFoundException('Phiên làm bài đã được nộp trước đó');
        }

        // Lấy questions để tính điểm
        const quizSet = await this.quizSetRepository.findOne({
            where: { id: (attempt as any).quizSetId },
            include: {
                detailsQuizQuestions: {
                    include: {
                        quizQuestion: true,
                    },
                },
            },
            cache: false,
        });

        if (!quizSet) {
            throw new NotFoundException('Bộ đề thi không tồn tại');
        }

        // Tính điểm
        const questions =
            (quizSet as any).detailsQuizQuestions
                ?.map((d: any) => d.quizQuestion)
                .filter((q: any) => q != null) || [];
        const answers = (attempt as any).answers as Record<string, string>;
        let correctCount = 0;

        questions.forEach((q: any) => {
            if (q && q.id && answers[q.id] === q.answer) {
                correctCount++;
            }
        });

        const totalQuestions = questions.length;
        const score =
            totalQuestions > 0 ? (correctCount / totalQuestions) * 100 : 0;

        try {
            const updatedAttempt = await this.attemptRepository.update(
                attemptId,
                {
                    isSubmitted: true,
                    submittedAt: new Date(),
                    score,
                    correctAnswers: correctCount,
                    totalQuestions,
                },
                user.id
            );

            return {
                message: 'Nộp bài thành công',
                attempt: updatedAttempt,
                score,
                totalQuestions,
                correctAnswers: correctCount,
                percentage: Math.round(score * 10) / 10,
            };
        } catch (error) {
            throw new InternalServerErrorException('Nộp bài thất bại');
        }
    }

    /**
     * Reset attempt để làm lại
     * Chỉ cho phép reset khi đã submit
     */
    async resetAttempt(
        attemptId: string,
        user: User,
        timeLimitMinutes?: number | null
    ) {
        const attempt = await this.attemptRepository.findOne({
            where: { id: attemptId, userId: user.id },
            cache: false,
        });

        if (!attempt) {
            throw new NotFoundException('Phiên làm bài không tồn tại');
        }

        if (!(attempt as any).isSubmitted) {
            throw new NotFoundException('Chỉ có thể reset bài đã nộp');
        }

        // Lấy totalQuestions từ quizSet
        const quizSet = await this.quizSetRepository.findOne({
            where: { id: (attempt as any).quizSetId },
            include: {
                detailsQuizQuestions: {
                    select: { id: true },
                },
            },
            cache: true,
        });

        const totalQuestions =
            (quizSet as any)?.detailsQuizQuestions?.length || 0;

        try {
            const resetAttempt = await this.attemptRepository.update(
                attemptId,
                {
                    answers: {},
                    currentIndex: 0,
                    markedQuestions: [],
                    timeSpentSeconds: 0,
                    timeLimitMinutes:
                        timeLimitMinutes ?? (attempt as any).timeLimitMinutes,
                    isSubmitted: false,
                    score: null,
                    correctAnswers: 0,
                    totalQuestions,
                    startedAt: new Date(),
                    submittedAt: null,
                },
                user.id
            );

            return {
                message: 'Reset phiên làm bài thành công',
                attempt: resetAttempt,
            };
        } catch (error) {
            throw new InternalServerErrorException(
                'Reset phiên làm bài thất bại'
            );
        }
    }

    /**
     * Lấy attempt theo ID
     */
    async getAttemptById(attemptId: string, user: User) {
        const attempt = await this.attemptRepository.findOne({
            where: { id: attemptId, userId: user.id },
            cache: true,
        });

        if (!attempt) {
            throw new NotFoundException('Phiên làm bài không tồn tại');
        }

        return attempt;
    }

    /**
     * Lấy attempt theo quizSetId và type
     */
    async getAttemptByQuizSetAndType(
        quizSetId: string,
        type: number,
        user: User
    ) {
        const attempt = await this.attemptRepository.findByUserQuizSetAndType(
            user.id,
            quizSetId,
            type,
            true
        );

        return attempt;
    }

    /**
     * Lấy tỷ lệ hoàn thành trung bình của user
     */
    async getAverageCompletionRate(user: User): Promise<number> {
        return this.attemptRepository.getAverageCompletionRate(user.id);
    }

    /**
     * Lấy danh sách latest attempts cho các quizSets
     * Dùng để hiển thị "học gần nhất" trong danh sách đề
     */
    async getLatestAttemptsForQuizSets(userId: string, quizSetIds: string[]) {
        return this.attemptRepository.findLatestAttemptsForQuizSets(
            userId,
            quizSetIds
        );
    }
}
