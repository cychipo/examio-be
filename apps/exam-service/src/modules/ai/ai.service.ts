import {
    Injectable,
    Logger,
    NotFoundException,
    BadRequestException,
    InternalServerErrorException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { User } from '@prisma/client';
import { GenerateIdService, R2ClientService } from '@examio/common';
import { AIRepository } from './ai.repository';
import {
    UploadFileDto,
    RegenerateDto,
    GenerateFromFileDto,
} from './dto/ai.dto';
import { firstValueFrom } from 'rxjs';
import { FinanceClientService } from '../finance-client/finance-client.service';

@Injectable()
export class AIService {
    private readonly logger = new Logger(AIService.name);
    private readonly aiServiceUrl: string;

    constructor(
        private readonly aiRepository: AIRepository,
        private readonly generateIdService: GenerateIdService,
        private readonly httpService: HttpService,
        private readonly financeClient: FinanceClientService,
        private readonly r2ClientService: R2ClientService
    ) {
        this.aiServiceUrl =
            process.env.AI_SERVICE_URL || 'http://localhost:8000/api';
    }

    /**
     * Quick upload - uploads file to R2 immediately without OCR processing.
     * OCR happens on-demand when first message is sent.
     */
    async quickUpload(
        user: User,
        file: Express.Multer.File
    ): Promise<{
        success: boolean;
        userStorageId: string;
        filename: string;
        url: string;
    }> {
        // Validate file
        if (!file || !file.buffer) {
            this.logger.error('Quick upload: No file provided');
            throw new BadRequestException('No file provided for upload');
        }

        this.logger.log(
            `Quick upload file: ${file.originalname} (${file.size} bytes, ${file.mimetype})`
        );

        try {
            // 1. Upload to R2 via gRPC - returns key (string)
            this.logger.log('Uploading to R2 via gRPC...');
            let keyR2: string;
            try {
                keyR2 = await this.r2ClientService.uploadFile(
                    file.originalname,
                    file.buffer,
                    file.mimetype,
                    'ai-teacher'
                );
            } catch (grpcError) {
                this.logger.error(
                    `gRPC R2 upload failed: ${grpcError.message}`,
                    grpcError.stack
                );
                throw new InternalServerErrorException(
                    `R2 Service error: ${grpcError.message}. Is R2 service running?`
                );
            }
            this.logger.log(`R2 upload success, key: ${keyR2}`);

            // Validate keyR2 is not undefined/empty
            if (!keyR2) {
                this.logger.error('R2 upload returned empty key');
                throw new InternalServerErrorException(
                    'R2 upload failed: No key returned from R2 service'
                );
            }

            // 2. Get public URL from key
            const url = this.r2ClientService.getPublicUrl(keyR2);

            // 3. Create UserStorage with PENDING status (no OCR yet)
            const id = this.generateIdService.generateId();
            const userStorage = await this.aiRepository.createUserStorage({
                id,
                userId: user.id,
                filename: file.originalname,
                url,
                mimetype: file.mimetype,
                size: file.size,
                keyR2,
                processingStatus: 'PENDING',
                creditCharged: false,
            });

            this.logger.log(
                `Quick upload created: ${userStorage.id} - ${file.originalname}`
            );

            return {
                success: true,
                userStorageId: userStorage.id,
                filename: file.originalname,
                url,
            };
        } catch (error) {
            this.logger.error(
                `Quick upload failed: ${error.message}`,
                error.stack
            );
            throw error;
        }
    }

    /**
     * Generate quiz/flashcard from uploaded file
     * Combines upload + regenerate into one step
     * Returns immediately after creating job - processing happens async via RabbitMQ
     */
    async generateFromFile(
        user: User,
        file: Express.Multer.File,
        dto: GenerateFromFileDto
    ): Promise<{
        jobId: string;
        status: string;
        message: string;
        newBalance?: number;
    }> {
        const startTime = Date.now();
        this.logger.log(`Generate from file: ${file.originalname}`);

        // Validate file
        if (!file || !file.buffer) {
            throw new BadRequestException('No file provided');
        }

        try {
            // 1. Upload to R2 via gRPC
            const uploadStart = Date.now();
            this.logger.log('Uploading to R2 via gRPC...');
            const keyR2 = await this.r2ClientService.uploadFile(
                file.originalname,
                file.buffer,
                file.mimetype,
                'ai-uploads'
            );
            this.logger.log(
                `R2 upload success in ${Date.now() - uploadStart}ms, key: ${keyR2}`
            );

            // 2. Get public URL
            const url = this.r2ClientService.getPublicUrl(keyR2);

            // 3. Calculate credits and deduct (skip if fails to let job run)
            const sizeMB = file.size / (1024 * 1024);
            const uploadCredits = Math.ceil(sizeMB / 2);
            const generateCredits = 5;
            const totalCredits = uploadCredits + generateCredits;

            let newBalance: number | undefined;
            const creditStart = Date.now();
            if (totalCredits > 0) {
                try {
                    const deductionResult =
                        await this.financeClient.deductCredits(
                            user.id,
                            totalCredits,
                            `Generate from file: ${file.originalname}`
                        );
                    if (deductionResult?.success) {
                        newBalance = deductionResult.newBalance;
                    }
                    this.logger.log(
                        `Credit deduction done in ${Date.now() - creditStart}ms`
                    );
                } catch (creditError) {
                    this.logger.warn(
                        `Credit deduction failed: ${creditError.message}`
                    );
                    throw creditError; // Re-throw to stop if not enough credits
                }
            }

            // 4. Create UserStorage with PENDING status
            const dbStart = Date.now();
            const id = this.generateIdService.generateId();
            const userStorage = await this.aiRepository.createUserStorage({
                id,
                userId: user.id,
                filename: file.originalname,
                url,
                mimetype: file.mimetype,
                size: file.size,
                keyR2,
                processingStatus: 'PENDING',
                creditCharged: true,
            });
            this.logger.log(`DB record created in ${Date.now() - dbStart}ms`);

            // 5. Call AI service directly via HTTP to process OCR + generate content
            // This is more reliable than RabbitMQ events for this use case
            const typeResult = parseInt(dto.typeResult, 10) || 1;
            const quantityQuizz = dto.quantityQuizz
                ? parseInt(dto.quantityQuizz, 10)
                : 10;
            const quantityFlashcard = dto.quantityFlashcard
                ? parseInt(dto.quantityFlashcard, 10)
                : 10;

            // Fire and forget - call AI service async without waiting
            this.processFileAsync(
                userStorage.id,
                user.id,
                typeResult,
                quantityQuizz,
                quantityFlashcard,
                dto.modelType
            ).catch((err) => {
                this.logger.error(
                    `Background processing failed for ${userStorage.id}: ${err.message}`
                );
            });

            this.logger.log(
                `Total generateFromFile time: ${Date.now() - startTime}ms`
            );

            return {
                jobId: userStorage.id,
                status: 'PENDING',
                message: 'File đã được upload, đang xử lý OCR và tạo nội dung',
                newBalance,
            };
        } catch (error) {
            this.logger.error(
                `Generate from file failed: ${error.message}`,
                error.stack
            );
            throw error;
        }
    }

    /**
     * Process file asynchronously - call AI service to OCR + generate content
     * This runs in background after returning jobId to client
     */
    private async processFileAsync(
        userStorageId: string,
        userId: string,
        typeResult: number,
        quantityQuizz: number,
        quantityFlashcard: number,
        modelType?: string
    ): Promise<void> {
        try {
            this.logger.log(
                `Starting async processing for ${userStorageId}...`
            );

            // Update status to PROCESSING
            await this.aiRepository.updateUserStorageStatus(
                userStorageId,
                'PROCESSING'
            );

            // Step 1: Call AI service to process OCR + embeddings
            this.logger.log(
                `Calling AI service to process file ${userStorageId}...`
            );
            const ocrResponse = await firstValueFrom(
                this.httpService.post(
                    `${this.aiServiceUrl}/ai/process-file`,
                    { user_storage_id: userStorageId },
                    { timeout: 300000 } // 5 min timeout for OCR
                )
            );

            if (!ocrResponse.data?.success) {
                throw new Error(
                    ocrResponse.data?.error || 'OCR processing failed'
                );
            }

            this.logger.log(
                `OCR completed for ${userStorageId}: ${ocrResponse.data.chunks_count} chunks`
            );

            // Step 2: Generate quiz or flashcard
            const isFlashcard = typeResult === 2;
            const count = isFlashcard ? quantityFlashcard : quantityQuizz;
            const endpoint = isFlashcard
                ? `${this.aiServiceUrl}/generate/flashcards`
                : `${this.aiServiceUrl}/generate/quiz`;

            this.logger.log(
                `Generating ${count} ${isFlashcard ? 'flashcards' : 'quiz questions'} for ${userStorageId} with model: ${modelType || 'gemini'}...`
            );

            const generateResponse = await firstValueFrom(
                this.httpService.post(
                    endpoint,
                    {
                        userStorageId,
                        userId,
                        [isFlashcard ? 'numFlashcards' : 'numQuestions']: count,
                        modelType: modelType || 'gemini',
                    },
                    { timeout: 300000 } // 5 min timeout for generation
                )
            );

            if (!generateResponse.data) {
                throw new Error('Content generation failed');
            }

            this.logger.log(
                `Generation completed for ${userStorageId}, historyId: ${generateResponse.data.history_id}`
            );

            // Status will be updated to COMPLETED by AI service
        } catch (error) {
            this.logger.error(
                `Async processing failed for ${userStorageId}: ${error.message}`
            );

            // Update status to FAILED
            try {
                await this.aiRepository.updateUserStorageStatus(
                    userStorageId,
                    'FAILED'
                );
            } catch (updateError) {
                this.logger.error(
                    `Failed to update status to FAILED: ${updateError.message}`
                );
            }
        }
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
     * Delete an upload and its file from R2
     */
    async deleteUpload(uploadId: string, user: User) {
        const upload = await this.getUploadDetail(uploadId, user);

        // Delete file from R2 if keyR2 exists
        if (upload.keyR2) {
            try {
                await this.r2ClientService.deleteFile(upload.keyR2);
                this.logger.log(`Deleted file from R2: ${upload.keyR2}`);
            } catch (error) {
                this.logger.warn(
                    `Failed to delete file from R2: ${upload.keyR2} - ${error.message}`
                );
                // Continue with database deletion even if R2 deletion fails
            }
        }

        // Delete related Documents (embeddings)
        try {
            await this.aiRepository.deleteDocumentsByUserStorageId(upload.id);
            this.logger.log(`Deleted documents for UserStorage: ${upload.id}`);
        } catch (error) {
            this.logger.warn(
                `Failed to delete documents for UserStorage: ${upload.id} - ${error.message}`
            );
        }

        await this.aiRepository.deleteUserStorage(upload.id);
        return { success: true, message: 'Xóa thành công' };
    }

    /**
     * Cancel a job that is in progress
     * This will delete the UserStorage and refund credits if applicable
     */
    async cancelJob(jobId: string, user: User) {
        const upload = await this.aiRepository.findUserStorageById(jobId);

        if (!upload) {
            return {
                success: false,
                message: 'Job không tồn tại',
            };
        }

        // Verify ownership
        if (upload.userId !== user.id) {
            return {
                success: false,
                message: 'Không có quyền hủy job này',
            };
        }

        // Only allow canceling pending or processing jobs
        if (
            upload.processingStatus !== 'PENDING' &&
            upload.processingStatus !== 'PROCESSING'
        ) {
            return {
                success: false,
                message: 'Không thể hủy job đã hoàn thành hoặc thất bại',
            };
        }

        // Delete file from R2 if keyR2 exists
        if (upload.keyR2) {
            try {
                await this.r2ClientService.deleteFile(upload.keyR2);
                this.logger.log(`Deleted file from R2: ${upload.keyR2}`);
            } catch (error) {
                this.logger.warn(
                    `Failed to delete file from R2: ${upload.keyR2} - ${error.message}`
                );
            }
        }

        // Delete related Documents (embeddings)
        try {
            await this.aiRepository.deleteDocumentsByUserStorageId(upload.id);
            this.logger.log(
                `Deleted documents for cancelled job: ${upload.id}`
            );
        } catch (error) {
            this.logger.warn(
                `Failed to delete documents for cancelled job: ${upload.id} - ${error.message}`
            );
        }

        // Refund credits if charged
        let newBalance: number | undefined;
        if (upload.creditCharged) {
            const sizeMB = upload.size / (1024 * 1024);
            const credits = Math.ceil(sizeMB / 2);
            if (credits > 0) {
                try {
                    const refundResult = await this.financeClient.addCredits(
                        user.id,
                        credits,
                        `Hoàn tiền hủy job: ${upload.filename}`
                    );
                    if (refundResult?.success) {
                        newBalance = refundResult.newBalance;
                        this.logger.log(
                            `Refunded ${credits} credits for cancelled job: ${upload.id}`
                        );
                    }
                } catch (error) {
                    this.logger.warn(
                        `Failed to refund credits for cancelled job: ${upload.id} - ${error.message}`
                    );
                }
            }
        }

        // Delete UserStorage
        await this.aiRepository.deleteUserStorage(upload.id);

        return {
            success: true,
            message: 'Đã hủy job và hoàn tiền thành công',
            newBalance,
        };
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

        // Process file asynchronously via HTTP to AI service
        this.processFileAsync(
            userStorage.id,
            user.id,
            dto.typeResult || 1,
            dto.quantityQuizz || 10,
            dto.quantityFlashcard || 10,
            dto.modelType
        ).catch((err) =>
            this.logger.error(`Background processing failed: ${err.message}`)
        );

        this.logger.log(
            `Started async processing for userStorageId: ${userStorage.id}`
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

        // If not yet processed or FAILED, trigger OCR first via HTTP
        if (
            upload.processingStatus === 'PENDING' ||
            upload.processingStatus === 'FAILED'
        ) {
            // Reset status to PENDING for retry
            if (upload.processingStatus === 'FAILED') {
                await this.aiRepository.updateUserStorageStatus(
                    uploadId,
                    'PENDING'
                );
                this.logger.log(`Retrying failed upload ${uploadId}`);
            }

            // Start async processing
            this.processFileAsync(
                upload.id,
                user.id,
                dto.typeResult || 1,
                dto.quantityQuizz || dto.count || 10,
                dto.quantityFlashcard || dto.count || 10,
                dto.modelType
            ).catch((err) =>
                this.logger.error(
                    `Background processing failed: ${err.message}`
                )
            );

            return {
                jobId: upload.id,
                status: 'processing',
                message:
                    upload.processingStatus === 'FAILED'
                        ? 'Đang thử lại xử lý file, vui lòng đợi...'
                        : 'Đang xử lý OCR, vui lòng thử lại sau',
            };
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
                            modelType: dto.modelType || 'gemini',
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
                            modelType: dto.modelType || 'gemini',
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
