import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { User } from '@prisma/client';
import {
    GenerateIdService,
    EventPublisherService,
    EventType,
    OcrRequestedPayload,
} from '@examio/common';
import { AIRepository } from './ai.repository';
import { UploadFileDto, RegenerateDto } from './dto/ai.dto';
import { firstValueFrom } from 'rxjs';
import { FinanceClientService } from '../finance-client/finance-client.service';

@Injectable()
export class AIService {
    private readonly logger = new Logger(AIService.name);
    private readonly aiServiceUrl: string;

    constructor(
        private readonly aiRepository: AIRepository,
        private readonly generateIdService: GenerateIdService,
        private readonly eventPublisher: EventPublisherService,
        private readonly httpService: HttpService,
        private readonly financeClient: FinanceClientService
    ) {
        this.aiServiceUrl =
            process.env.AI_SERVICE_URL || 'http://localhost:8000/api';
    }

    /**
     * Get recent uploads for a user
     * Returns array directly for frontend compatibility
     */
    async getRecentUploads(user: User, page = 1, size = 10) {
        const result = await this.aiRepository.findUserStoragesByUserId(
            user.id,
            { page, size }
        );

        // Return array directly for frontend compatibility
        return result.data;
    }

    /**
     * Get upload details by ID
     */
    async getUploadDetail(uploadId: string, user: User) {
        const upload = await this.aiRepository.findUserStorageById(uploadId);

        if (!upload) {
            throw new NotFoundException('Upload không tồn tại');
        }

        if (upload.userId !== user.id) {
            throw new NotFoundException('Upload không tồn tại');
        }

        return upload;
    }

    /**
     * Delete an upload
     */
    async deleteUpload(uploadId: string, user: User) {
        const upload = await this.getUploadDetail(uploadId, user);
        await this.aiRepository.deleteUserStorage(upload.id);
        return { success: true, message: 'Xóa thành công' };
    }

    /**
     * Create a new upload and trigger OCR processing
     */
    async createUpload(user: User, dto: UploadFileDto) {
        // Calculate credits: 1 credit per 2MB
        const sizeMB = dto.size / (1024 * 1024);
        const credits = Math.ceil(sizeMB / 2);

        let creditCharged = false;
        let newBalance: number | undefined;

        if (credits > 0) {
            const deductionResult = await this.financeClient.deductCredits(
                user.id,
                credits,
                `Upload file: ${dto.filename} (${sizeMB.toFixed(2)} MB)`
            );
            creditCharged = true;
            if (deductionResult?.success) {
                newBalance = deductionResult.newBalance;
            }
        }

        const id = this.generateIdService.generateId();

        // Create UserStorage with PENDING status
        const userStorage = await this.aiRepository.createUserStorage({
            id,
            userId: user.id,
            filename: dto.filename,
            url: dto.url,
            mimetype: dto.mimetype,
            size: dto.size,
            keyR2: dto.keyR2,
            processingStatus: 'PENDING',
            creditCharged,
        });

        // Publish OCR_REQUESTED event to RabbitMQ
        const payload: OcrRequestedPayload = {
            userStorageId: userStorage.id,
            userId: user.id,
            fileUrl: dto.url,
            fileName: dto.filename,
            mimeType: dto.mimetype,
        };

        await this.eventPublisher.publish(
            `ai.${EventType.OCR_REQUESTED}`,
            EventType.OCR_REQUESTED,
            payload,
            { sourceService: 'exam-service' }
        );

        this.logger.log(
            `Published OCR_REQUESTED for userStorageId: ${userStorage.id}`
        );

        return {
            id: userStorage.id,
            status: 'PENDING',
            newBalance,
            message: 'File đã được upload, đang xử lý OCR',
        };
    }

    /**
     * Regenerate quiz/flashcard from an existing upload
     * Calls AI service to actually generate content
     */
    async regenerate(uploadId: string, user: User, dto: RegenerateDto) {
        const upload = await this.getUploadDetail(uploadId, user);

        // If not yet processed, trigger OCR first
        if (upload.processingStatus === 'PENDING') {
            const payload: OcrRequestedPayload = {
                userStorageId: upload.id,
                userId: user.id,
                fileUrl: upload.url,
                fileName: upload.filename,
                mimeType: upload.mimetype,
            };

            await this.eventPublisher.publish(
                `ai.${EventType.OCR_REQUESTED}`,
                EventType.OCR_REQUESTED,
                payload,
                { sourceService: 'exam-service' }
            );

            return {
                jobId: upload.id,
                status: 'processing',
                message: 'Đang xử lý OCR, vui lòng thử lại sau',
            };
        }

        if (upload.processingStatus === 'FAILED') {
            throw new NotFoundException(
                'File xử lý thất bại, vui lòng upload lại'
            );
        }

        // OCR is complete, call AI service to generate content
        try {
            // Parse FE request format: typeResult (1=quiz, 2=flashcard)
            const isFlashcard = dto.typeResult === 2;
            const outputType = isFlashcard
                ? 'flashcard'
                : dto.outputType || 'quiz';
            const count = isFlashcard
                ? dto.quantityFlashcard || dto.count || 10
                : dto.quantityQuizz || dto.count || 10;

            // Deduct credits: 1 credit per 10 items
            const credits = Math.ceil(count / 10);
            let newBalance: number | undefined;

            if (credits > 0) {
                const deductionResult = await this.financeClient.deductCredits(
                    user.id,
                    credits,
                    `Generate ${count} ${outputType}s from file ${upload.filename}`
                );
                if (deductionResult?.success) {
                    newBalance = deductionResult.newBalance;
                }
            }

            this.logger.log(
                `Calling AI service to generate ${count} ${outputType} for upload ${upload.id}`
            );

            if (outputType === 'flashcard') {
                // Generate flashcards
                const response = await firstValueFrom(
                    this.httpService.post(
                        `${this.aiServiceUrl}/generate/flashcards`,
                        {
                            userStorageId: upload.id,
                            userId: user.id,
                            numFlashcards: count,
                            isNarrowSearch: dto.isNarrowSearch,
                            keyword: dto.keyword,
                        }
                    )
                );

                return {
                    jobId: upload.id,
                    status: 'completed',
                    newBalance,
                    result: {
                        type: 'flashcard',
                        flashcards: response.data.flashcards,
                        historyId: response.data.history_id,
                        fileInfo: {
                            id: upload.id,
                            filename: upload.filename,
                        },
                    },
                };
            } else {
                // Generate quiz
                const response = await firstValueFrom(
                    this.httpService.post(
                        `${this.aiServiceUrl}/generate/quiz`,
                        {
                            userStorageId: upload.id,
                            userId: user.id,
                            numQuestions: count,
                            isNarrowSearch: dto.isNarrowSearch,
                            keyword: dto.keyword,
                        }
                    )
                );

                return {
                    jobId: upload.id,
                    status: 'completed',
                    newBalance,
                    result: {
                        type: 'quiz',
                        quizzes: response.data.quizzes,
                        historyId: response.data.history_id,
                        fileInfo: {
                            id: upload.id,
                            filename: upload.filename,
                        },
                    },
                };
            }
        } catch (error) {
            this.logger.error(`Error calling AI service: ${error.message}`);
            throw new NotFoundException(
                `Lỗi khi tạo nội dung: ${error.message}`
            );
        }
    }

    /**
     * Get job status (check processing status and return result if available)
     * Returns result for FE polling pattern
     */
    async getJobStatus(jobId: string, user: User) {
        const upload = await this.getUploadDetail(jobId, user);

        // Check if quiz or flashcard was generated
        const [quizHistory, flashcardHistory] = await Promise.all([
            this.aiRepository.findLatestQuizHistory(upload.id),
            this.aiRepository.findLatestFlashcardHistory(upload.id),
        ]);

        // Determine which one is more recent
        let returnType: 'quiz' | 'flashcard' | null = null;

        if (quizHistory && flashcardHistory) {
            // Both exist, return the most recent one
            const quizDate = new Date(quizHistory.createdAt).getTime();
            const flashcardDate = new Date(
                flashcardHistory.createdAt
            ).getTime();
            returnType = flashcardDate > quizDate ? 'flashcard' : 'quiz';
        } else if (quizHistory) {
            returnType = 'quiz';
        } else if (flashcardHistory) {
            returnType = 'flashcard';
        }

        // Return quiz result
        if (returnType === 'quiz' && quizHistory) {
            return {
                jobId: upload.id,
                status: 'completed',
                result: {
                    type: 'quiz',
                    quizzes: quizHistory.quizzes,
                    historyId: quizHistory.id,
                    fileInfo: {
                        id: upload.id,
                        filename: upload.filename,
                    },
                },
            };
        }

        // Return flashcard result
        if (returnType === 'flashcard' && flashcardHistory) {
            return {
                jobId: upload.id,
                status: 'completed',
                result: {
                    type: 'flashcard',
                    flashcards: flashcardHistory.flashcards,
                    historyId: flashcardHistory.id,
                    fileInfo: {
                        id: upload.id,
                        filename: upload.filename,
                    },
                },
            };
        }

        // No result yet, return processing status
        return {
            jobId: upload.id,
            status: upload.processingStatus?.toLowerCase() || 'pending',
            filename: upload.filename,
            createdAt: upload.createdAt,
        };
    }

    /**
     * Get full history (quiz and flashcard) for an upload
     * Used when selecting a recent file to load previous results
     */
    async getUploadHistory(uploadId: string, user: User) {
        const upload = await this.getUploadDetail(uploadId, user);

        const [quizHistory, flashcardHistory] = await Promise.all([
            this.aiRepository.findLatestQuizHistory(upload.id),
            this.aiRepository.findLatestFlashcardHistory(upload.id),
        ]);

        return {
            uploadId: upload.id,
            filename: upload.filename,
            quizHistory: quizHistory
                ? {
                      id: quizHistory.id,
                      quizzes: quizHistory.quizzes,
                      createdAt: quizHistory.createdAt,
                  }
                : null,
            flashcardHistory: flashcardHistory
                ? {
                      id: flashcardHistory.id,
                      flashcards: flashcardHistory.flashcards,
                      createdAt: flashcardHistory.createdAt,
                  }
                : null,
        };
    }
}
