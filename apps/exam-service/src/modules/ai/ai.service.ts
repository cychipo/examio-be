import {
    Injectable,
    Logger,
    NotFoundException,
    BadRequestException,
    InternalServerErrorException,
    ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { AxiosError } from 'axios';
import { User } from '@prisma/client';
import {
    GenerateIdService,
    R2ClientService,
    sanitizeFilename,
} from '@examio/common';
import { AIRepository } from './ai.repository';
import {
    UploadFileDto,
    RegenerateDto,
    GenerateFromFileDto,
    TutorIngestDto,
    TutorKnowledgeFolderDto,
    TutorKnowledgeUploadDto,
    TutorQueryDto,
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

    private getDefaultModelId(): string {
        return 'qwen3_8b';
    }

    private normalizeModelUnavailableMessage(errorData: unknown): string | null {
        const payload = errorData as
            | { detail?: { code?: string; message?: string } | string; message?: string; error?: string }
            | undefined;

        const detail = payload?.detail;
        if (detail && typeof detail === 'object' && 'code' in detail) {
            const code = detail.code;
            if (
                code === 'MODEL_UNAVAILABLE' ||
                code === 'MODEL_INSUFFICIENT_VRAM' ||
                code === 'MODEL_RUNTIME_ERROR'
            ) {
                return 'Model hiện tại không khả dụng, thử model khác.';
            }
        }

        return null;
    }

    private rethrowAiHttpError(error: unknown): never {
        const axiosError = error as AxiosError<{
            detail?: string;
            error?: string;
            message?: string;
            status_code?: number;
        }>;

        const status = axiosError.response?.status;
        const data = axiosError.response?.data;
        const message =
            data?.detail || data?.error || data?.message || axiosError.message;

        if (status === 400) {
            throw new BadRequestException(message);
        }

        if (status === 404) {
            throw new NotFoundException(message);
        }

        throw new InternalServerErrorException(message);
    }

    private async clearAiServiceCache(userStorageId: string) {
        try {
            await firstValueFrom(
                this.httpService.delete(
                    `${this.aiServiceUrl}/ai/clear-cache/${userStorageId}`,
                    { timeout: 15000 }
                )
            );
            this.logger.log(
                `Cleared AI service retrieval cache for UserStorage: ${userStorageId}`
            );
        } catch (error) {
            this.logger.warn(
                `Failed to clear AI service retrieval cache for UserStorage: ${userStorageId} - ${error.message}`
            );
        }
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
            // Sanitize filename to handle Vietnamese characters
            const sanitizedName = `${Date.now()}-${sanitizeFilename(file.originalname)}`;
            this.logger.log('Uploading to R2 via gRPC...');
            let keyR2: string;
            try {
                keyR2 = await this.r2ClientService.uploadFile(
                    sanitizedName,
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
        this.logger.log(`Received DTO: ${JSON.stringify(dto)}`);

        // Validate file
        if (!file || !file.buffer) {
            throw new BadRequestException('No file provided');
        }

        try {
            // 1. Check for duplicate upload first
            const existingStorage =
                await this.aiRepository.findDuplicateUserStorage(
                    user.id,
                    file.originalname,
                    file.size
                );

            if (existingStorage) {
                this.logger.log(
                    `Duplicate found (${existingStorage.processingStatus}), reusing: ${existingStorage.id}`
                );

                if (existingStorage.processingStatus === 'PROCESSING') {
                    return {
                        jobId: existingStorage.id,
                        status: 'processing',
                        message: 'File này đang được xử lý, vui lòng chờ hoàn tất.',
                    };
                }

                // Common reuse logic
                const generateCredits = 5;
                let newBalance: number | undefined;

                if (existingStorage.processingStatus === 'COMPLETED') {
                    // COMPLETED case: Charge only for generation
                    if (generateCredits > 0) {
                        try {
                            const deductionResult =
                                await this.financeClient.deductCredits(
                                    user.id,
                                    generateCredits,
                                    `Generate from EXISTING file: ${file.originalname}`
                                );
                            if (deductionResult?.success)
                                newBalance = deductionResult.newBalance;
                        } catch (err) {
                            this.logger.warn(
                                `Credit deduction failed: ${err.message}`
                            );
                        }
                    }

                    // Mark PROCESSING immediately so polling does not read stale history
                    await this.aiRepository.updateUserStorageStatus(
                        existingStorage.id,
                        'PROCESSING'
                    );
                } else {
                    // FAILED/PENDING case: Treat as retry.
                    await this.aiRepository.updateUserStorageStatus(
                        existingStorage.id,
                        'PENDING'
                    );
                }

                // Process async (Generate content + OCR if needed)
                const typeResult = this.normalizeTypeResult(dto.typeResult);
                const quantityQuizz = dto.quantityQuizz
                    ? parseInt(dto.quantityQuizz, 10)
                    : 10;
                const quantityFlashcard = dto.quantityFlashcard
                    ? parseInt(dto.quantityFlashcard, 10)
                    : 10;

                this.logger.log(
                    `Parsed DTO - typeResult: ${dto.typeResult}, modelType: ${dto.modelType}`
                );

                this.processFileAsync(
                    existingStorage.id,
                    user.id,
                    typeResult,
                    quantityQuizz,
                    quantityFlashcard,
                    dto.modelType,
                    dto.isNarrowSearch === 'true',
                    dto.keyword?.trim() || undefined,
                    existingStorage.processingStatus === 'COMPLETED'
                ).catch((err) =>
                    this.logger.error(
                        `Reused background processing failed: ${err.message}`
                    )
                );

                return {
                    jobId: existingStorage.id,
                    status: 'processing',
                    message:
                        existingStorage.processingStatus === 'COMPLETED'
                            ? 'File đã tồn tại, đang tạo nội dung mới...'
                            : 'Đang xử lý lại file cũ...',
                    newBalance,
                };
            }

            // 1b. Upload to R2 via gRPC
            // Sanitize filename to handle Vietnamese characters
            const sanitizedName = `${Date.now()}-${sanitizeFilename(file.originalname)}`;
            const uploadStart = Date.now();
            this.logger.log('Uploading to R2 via gRPC...');
            const keyR2 = await this.r2ClientService.uploadFile(
                sanitizedName,
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
            const typeResult = this.normalizeTypeResult(dto.typeResult);
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
                dto.modelType,
                dto.isNarrowSearch === 'true',
                dto.keyword?.trim() || undefined
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
    private normalizeTypeResult(typeResult?: number | string): number {
        const parsed = Number(typeResult);
        return parsed === 2 ? 2 : 1;
    }

    private async processFileAsync(
        userStorageId: string,
        userId: string,
        typeResult: number,
        quantityQuizz: number,
        quantityFlashcard: number,
        modelType?: string,
        isNarrowSearch: boolean = false,
        keyword?: string,
        ignoreProcessingStatusGuard: boolean = false
    ): Promise<void> {
        const startTime = Date.now();

        try {
            this.logger.log(
                `Starting async processing for ${userStorageId}...`
            );

            // Fetch current status to check if we can skip OCR
            const currentStorage =
                await this.aiRepository.findUserStorageById(userStorageId);

            if (!currentStorage) {
                throw new Error(`UserStorage not found: ${userStorageId}`);
            }

            if (
                !ignoreProcessingStatusGuard &&
                currentStorage.processingStatus === 'PROCESSING'
            ) {
                this.logger.warn(
                    `Skip starting duplicate processing job for ${userStorageId} because another job is already PROCESSING`
                );
                return;
            }

            const documentCount =
                await this.aiRepository.countDocumentsByUserStorageId(userStorageId);
            const skipOcr = documentCount > 0;

            this.logger.log(
                `[AI_TIMING] job=${userStorageId} stage=prepare skipOcr=${skipOcr} documentCount=${documentCount} typeResult=${typeResult} qQuiz=${quantityQuizz} qFlash=${quantityFlashcard}`
            );

            // Always mark PROCESSING while this generation job is running
            await this.aiRepository.updateUserStorageStatus(
                userStorageId,
                'PROCESSING'
            );

            if (!skipOcr) {
                // Step 1: Call AI service to process OCR + embeddings
                this.logger.log(
                    `Calling AI service to process file ${userStorageId}...`
                );
                const processFilePayload = modelType
                    ? { user_storage_id: userStorageId, modelType }
                    : { user_storage_id: userStorageId };

                const ocrStart = Date.now();
                const ocrResponse = await firstValueFrom(
                    this.httpService.post(
                        `${this.aiServiceUrl}/ai/process-file`,
                        processFilePayload,
                        { timeout: 3600000 } // 60 min timeout for OCR
                    )
                );

                if (!ocrResponse.data?.success) {
                    throw new Error(
                        ocrResponse.data?.error || 'OCR processing failed'
                    );
                }

                this.logger.log(
                    `[AI_TIMING] job=${userStorageId} stage=ocr_ms value=${Date.now() - ocrStart} chunks=${ocrResponse.data.chunks_count}`
                );
                this.logger.log(
                    `OCR completed for ${userStorageId}: ${ocrResponse.data.chunks_count} chunks`
                );
            } else {
                this.logger.log(
                    `Skipping OCR for file with existing embeddings: ${userStorageId} (${documentCount} chunks)`
                );
            }

            // Keep PROCESSING only when OCR was skipped (regenerate path).
            // If OCR just completed, AI service already set status COMPLETED and generation endpoint requires it.
            if (skipOcr) {
                await this.aiRepository.updateUserStorageStatus(
                    userStorageId,
                    'PROCESSING'
                );
            }

            // Step 2: Generate quiz or flashcard
            const isFlashcard = typeResult === 2;
            const count = isFlashcard ? quantityFlashcard : quantityQuizz;
            const endpoint = isFlashcard
                ? `${this.aiServiceUrl}/generate/flashcards`
                : `${this.aiServiceUrl}/generate/quiz`;

            this.logger.log(
                `Generating ${count} ${isFlashcard ? 'flashcards' : 'quiz questions'} for ${userStorageId} with model: ${modelType || this.getDefaultModelId()}...`
            );

            const generationStart = Date.now();
            const generateResponse = await firstValueFrom(
                this.httpService.post(
                    endpoint,
                    {
                        userStorageId,
                        userId,
                        [isFlashcard ? 'numFlashcards' : 'numQuestions']: count,
                        isNarrowSearch,
                        keyword,
                        modelType: modelType || this.getDefaultModelId(),
                    },
                    { timeout: 3600000 } // 60 min timeout for generation
                )
            );

            if (!generateResponse.data?.success) {
                throw new Error(
                    generateResponse.data?.error || 'Content generation failed'
                );
            }

            // Mark completed only when generation actually succeeds
            await this.aiRepository.updateUserStorageStatus(
                userStorageId,
                'COMPLETED'
            );

            this.logger.log(
                `[AI_TIMING] job=${userStorageId} stage=generation_ms value=${Date.now() - generationStart} outputType=${isFlashcard ? 'flashcard' : 'quiz'} count=${count}`
            );
            this.logger.log(
                `[AI_TIMING] job=${userStorageId} stage=total_ms value=${Date.now() - startTime} skipOcr=${skipOcr}`
            );
            this.logger.log(
                `Generation completed for ${userStorageId}, historyId: ${generateResponse.data.history_id}`
            );
        } catch (error) {
            const errorDetails = error.response?.data || error.message;
            const normalizedModelError = this.normalizeModelUnavailableMessage(
                error.response?.data
            );
            this.logger.error(
                `Async processing failed for ${userStorageId}: ${JSON.stringify(errorDetails)}`,
                error.stack
            );
            this.logger.log(
                `[AI_TIMING] job=${userStorageId} stage=failed_total_ms value=${Date.now() - startTime}`
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

            if (normalizedModelError) {
                throw new ServiceUnavailableException(normalizedModelError);
            }
        }
    }

    async getModelCatalog() {
        try {
            const response = await firstValueFrom(
                this.httpService.get(`${this.aiServiceUrl}/ai/models`, {
                    timeout: 15000,
                })
            );
            return response.data;
        } catch (error) {
            this.logger.error(
                `Failed to fetch model catalog: ${error.message}`,
                error.stack
            );
            throw new InternalServerErrorException(
                'Không thể tải danh sách model AI'
            );
        }
    }

    async tutorIngest(user: User, dto: TutorIngestDto) {
        try {
            const response = await firstValueFrom(
                this.httpService.post(`${this.aiServiceUrl}/tutor/ingest`, {
                    ...dto,
                    triggeredBy: dto.triggeredBy || user.id,
                })
            );
            return response.data;
        } catch (error) {
            this.logger.error(`Tutor ingest failed: ${error.message}`, error.stack);
            throw new InternalServerErrorException(
                error.response?.data?.detail || 'Không thể tạo tutor ingest job'
            );
        }
    }

    async uploadTutorKnowledgeFile(
        user: User,
        file: Express.Multer.File,
        dto: TutorKnowledgeUploadDto
    ) {
        if (!file || !file.buffer) {
            throw new BadRequestException('No file provided for tutor knowledge upload');
        }

        const allowedMimeTypes = new Set([
            'application/pdf',
            'application/json',
            'text/json',
        ]);
        const allowedExtensions = new Set(['.pdf', '.json']);
        const extension = file.originalname.slice(
            Math.max(0, file.originalname.lastIndexOf('.'))
        ).toLowerCase();

        if (
            !allowedMimeTypes.has(file.mimetype) &&
            !allowedExtensions.has(extension)
        ) {
            throw new BadRequestException(
                'Chỉ hỗ trợ file PDF hoặc JSON cho kho tri thức GenAI'
            );
        }

        try {
            const sanitizedName = `${Date.now()}-${sanitizeFilename(file.originalname)}`;
            const keyR2 = await this.r2ClientService.uploadFile(
                sanitizedName,
                file.buffer,
                file.mimetype,
                'genai-tutor-knowledge'
            );
            const url = this.r2ClientService.getPublicUrl(keyR2);
            const fileId = this.generateIdService.generateId();

            const response = await firstValueFrom(
                this.httpService.post(`${this.aiServiceUrl}/tutor/knowledge-files`, {
                    fileId,
                    userId: user.id,
                    filename: file.originalname,
                    description: dto.description,
                    url,
                    keyR2,
                    mimeType: file.mimetype,
                    size: file.size,
                    folderId: dto.folderId,
                    folderName: dto.folderName,
                    folderDescription: dto.folderDescription,
                    courseCode: dto.courseCode,
                    language: dto.language,
                    topic: dto.topic,
                    difficulty: dto.difficulty,
                })
            );

            return {
                ...response.data,
                filename: file.originalname,
                mimeType: file.mimetype,
                size: file.size,
            };
        } catch (error) {
            this.logger.error(`Tutor knowledge upload failed: ${error.message}`, error.stack);
            throw new InternalServerErrorException(
                error.response?.data?.detail || 'Không thể upload file tri thức tutor'
            );
        }
    }

    async getTutorKnowledgeFileStatus(fileId: string) {
        try {
            const response = await firstValueFrom(
                this.httpService.get(`${this.aiServiceUrl}/tutor/knowledge-files/${fileId}`)
            );
            return response.data;
        } catch (error) {
            this.logger.error(`Tutor knowledge status failed: ${error.message}`);
            throw new NotFoundException('Tutor knowledge file không tồn tại');
        }
    }

    async deleteTutorKnowledgeFile(fileId: string) {
        try {
            const response = await firstValueFrom(
                this.httpService.delete(`${this.aiServiceUrl}/tutor/knowledge-files/${fileId}`)
            );
            const deleted = response.data as { keyR2?: string };
            if (deleted.keyR2) {
                await this.r2ClientService.deleteFile(deleted.keyR2);
            }
            return { success: true };
        } catch (error) {
            this.logger.error(`Tutor knowledge delete failed: ${error.message}`, error.stack);
            throw new InternalServerErrorException(
                error.response?.data?.detail || 'Không thể xóa file tri thức tutor'
            );
        }
    }

    async createTutorKnowledgeFolder(user: User, dto: TutorKnowledgeFolderDto) {
        const folderId = dto.folderId || this.generateIdService.generateId();
        const response = await firstValueFrom(
            this.httpService.post(`${this.aiServiceUrl}/tutor/knowledge-folders`, {
                folderId,
                userId: user.id,
                name: dto.name,
                description: dto.description,
                icon: dto.icon,
            })
        );
        return response.data;
    }

    async updateTutorKnowledgeFolder(user: User, folderId: string, dto: TutorKnowledgeFolderDto) {
        const response = await firstValueFrom(
            this.httpService.put(`${this.aiServiceUrl}/tutor/knowledge-folders/${folderId}`, {
                folderId,
                userId: user.id,
                name: dto.name,
                description: dto.description,
                icon: dto.icon,
            })
        );
        return response.data;
    }

    async deleteTutorKnowledgeFolder(folderId: string) {
        const response = await firstValueFrom(
            this.httpService.delete(`${this.aiServiceUrl}/tutor/knowledge-folders/${folderId}`)
        );
        const payload = response.data as {
            success: boolean;
            deletedFiles?: Array<{ keyR2?: string }>;
        };
        for (const file of payload.deletedFiles || []) {
            if (file.keyR2) {
                await this.r2ClientService.deleteFile(file.keyR2);
            }
        }
        return response.data;
    }

    async getTutorKnowledgeFolderContents(
        user: User,
        folderId: string,
        page: number = 1,
        pageSize: number = 12
    ) {
        const response = await firstValueFrom(
            this.httpService.get(`${this.aiServiceUrl}/tutor/knowledge-folders/${folderId}/contents`, {
                params: { user_id: user.id, page, page_size: pageSize },
            })
        );
        return response.data;
    }

    async listTutorKnowledgeFolders(user: User) {
        const response = await firstValueFrom(
            this.httpService.get(`${this.aiServiceUrl}/tutor/knowledge-folders`, {
                params: { user_id: user.id },
            })
        );
        return response.data;
    }

    async getTutorKnowledgeStats(user: User, folderId?: string) {
        const response = await firstValueFrom(
            this.httpService.get(`${this.aiServiceUrl}/tutor/knowledge-stats`, {
                params: {
                    user_id: user.id,
                    folder_id: folderId,
                },
            })
        );
        return response.data;
    }

    async listTutorKnowledgeFiles(user: User) {
        const response = await firstValueFrom(
            this.httpService.get(`${this.aiServiceUrl}/tutor/knowledge-files`, {
                params: { user_id: user.id, page: 1, page_size: 12 },
            })
        );
        return response.data;
    }

    async listTutorDatasetCatalog() {
        const response = await firstValueFrom(
            this.httpService.get(`${this.aiServiceUrl}/tutor/dataset-imports/catalog`)
        );
        return response.data;
    }

    async createTutorDatasetImport(user: User, payload: { folderId?: string; datasetKey: string }) {
        try {
            const response = await firstValueFrom(
                this.httpService.post(`${this.aiServiceUrl}/tutor/dataset-imports`, {
                    userId: user.id,
                    folderId: payload.folderId,
                    datasetKey: payload.datasetKey,
                })
            );
            return response.data;
        } catch (error) {
            this.rethrowAiHttpError(error);
        }
    }

    async listTutorDatasetImports(user: User) {
        const response = await firstValueFrom(
            this.httpService.get(`${this.aiServiceUrl}/tutor/dataset-imports`, {
                params: { user_id: user.id },
            })
        );
        return response.data;
    }

    async listTutorDatasetImportStates(user: User) {
        const response = await firstValueFrom(
            this.httpService.get(`${this.aiServiceUrl}/tutor/dataset-imports/states`, {
                params: { user_id: user.id },
            })
        );
        return response.data;
    }

    async getTutorDatasetImportJob(jobId: string) {
        try {
            const response = await firstValueFrom(
                this.httpService.get(`${this.aiServiceUrl}/tutor/dataset-imports/${jobId}`)
            );
            return response.data;
        } catch (error) {
            this.rethrowAiHttpError(error);
        }
    }

    async cancelTutorDatasetImportJob(jobId: string) {
        try {
            const response = await firstValueFrom(
                this.httpService.post(`${this.aiServiceUrl}/tutor/dataset-imports/${jobId}/cancel`, {})
            );
            return response.data;
        } catch (error) {
            this.rethrowAiHttpError(error);
        }
    }

    async clearTutorDatasetImport(user: User, datasetKey: string) {
        try {
            const response = await firstValueFrom(
                this.httpService.post(`${this.aiServiceUrl}/tutor/dataset-imports/${datasetKey}/clear`, null, {
                    params: { user_id: user.id },
                })
            );
            return response.data;
        } catch (error) {
            this.rethrowAiHttpError(error);
        }
    }

    async searchTutorKnowledgeFiles(
        user: User,
        query: {
            folderId?: string;
            status?: string;
            search?: string;
            sortBy?: string;
            sortOrder?: string;
            page?: number;
            pageSize?: number;
        }
    ) {
        const response = await firstValueFrom(
            this.httpService.get(`${this.aiServiceUrl}/tutor/knowledge-files`, {
                params: {
                    user_id: user.id,
                    folder_id: query.folderId,
                    status: query.status,
                    search: query.search,
                    sort_by: query.sortBy,
                    sort_order: query.sortOrder,
                    page: query.page,
                    page_size: query.pageSize,
                },
            })
        );
        return response.data;
    }

    async reprocessTutorKnowledgeFile(fileId: string) {
        const response = await firstValueFrom(
            this.httpService.post(`${this.aiServiceUrl}/tutor/knowledge-files/${fileId}/reprocess`, {})
        );
        return response.data;
    }

    async bulkDeleteTutorKnowledgeFiles(fileIds: string[]) {
        const response = await firstValueFrom(
            this.httpService.post(`${this.aiServiceUrl}/tutor/knowledge-files/bulk-delete`, {
                fileIds,
            })
        );
        const payload = response.data as {
            success: boolean;
            deletedFiles?: Array<{ keyR2?: string }>;
        };
        for (const file of payload.deletedFiles || []) {
            if (file.keyR2) {
                await this.r2ClientService.deleteFile(file.keyR2);
            }
        }
        return response.data;
    }

    async bulkReprocessTutorKnowledgeFiles(fileIds: string[]) {
        const response = await firstValueFrom(
            this.httpService.post(`${this.aiServiceUrl}/tutor/knowledge-files/bulk-reprocess`, {
                fileIds,
            })
        );
        return response.data;
    }

    async getTutorIngestJob(jobId: string) {
        try {
            const response = await firstValueFrom(
                this.httpService.get(`${this.aiServiceUrl}/tutor/ingest/${jobId}`)
            );
            return response.data;
        } catch (error) {
            this.logger.error(`Tutor ingest job lookup failed: ${error.message}`);
            throw new NotFoundException('Tutor ingest job không tồn tại');
        }
    }

    async listTutorIngestJobs() {
        try {
            const response = await firstValueFrom(
                this.httpService.get(`${this.aiServiceUrl}/tutor/ingest`)
            );
            return response.data;
        } catch (error) {
            this.logger.error(`Tutor ingest list failed: ${error.message}`);
            throw new InternalServerErrorException('Không thể lấy danh sách tutor ingest jobs');
        }
    }

    async tutorQuery(dto: TutorQueryDto) {
        try {
            const response = await firstValueFrom(
                this.httpService.post(`${this.aiServiceUrl}/tutor/query`, dto, {
                    timeout: 300000,
                })
            );
            return response.data;
        } catch (error) {
            this.logger.error(`Tutor query failed: ${error.message}`, error.stack);
            throw new InternalServerErrorException(
                error.response?.data?.detail || 'Không thể truy vấn tutor'
            );
        }
    }

    async tutorStream(dto: TutorQueryDto) {
        try {
            const response = await firstValueFrom(
                this.httpService.post(`${this.aiServiceUrl}/tutor/stream`, dto, {
                    timeout: 300000,
                    responseType: 'text',
                })
            );
            return response.data;
        } catch (error) {
            this.logger.error(`Tutor stream failed: ${error.message}`, error.stack);
            throw new InternalServerErrorException(
                error.response?.data?.detail || 'Không thể stream tutor response'
            );
        }
    }

    async listStudentProgrammingSessions(user: User) {
        const response = await firstValueFrom(
            this.httpService.get(`${this.aiServiceUrl}/tutor/student-programming/sessions`, {
                params: { user_id: user.id },
            })
        );
        return response.data;
    }

    async createStudentProgrammingSession(user: User, title?: string) {
        const response = await firstValueFrom(
            this.httpService.post(`${this.aiServiceUrl}/tutor/student-programming/sessions`, {
                userId: user.id,
                title,
            })
        );
        return response.data;
    }

    async updateStudentProgrammingSession(user: User, sessionId: string, title: string) {
        const response = await firstValueFrom(
            this.httpService.patch(`${this.aiServiceUrl}/tutor/student-programming/sessions/${sessionId}`, {
                userId: user.id,
                title,
            })
        );
        return response.data;
    }

    async deleteStudentProgrammingSession(user: User, sessionId: string) {
        const response = await firstValueFrom(
            this.httpService.delete(`${this.aiServiceUrl}/tutor/student-programming/sessions/${sessionId}`, {
                params: { user_id: user.id },
            })
        );
        return response.data;
    }

    async listStudentProgrammingMessages(user: User, sessionId: string) {
        const response = await firstValueFrom(
            this.httpService.get(`${this.aiServiceUrl}/tutor/student-programming/sessions/${sessionId}/messages`, {
                params: { user_id: user.id },
            })
        );
        return response.data;
    }

    async createStudentProgrammingMessage(
        user: User,
        sessionId: string,
        payload: {
            content: string;
            role: 'assistant' | 'user';
            sources?: any[];
            confidence?: number;
            modelUsed?: string;
        }
    ) {
        const response = await firstValueFrom(
            this.httpService.post(`${this.aiServiceUrl}/tutor/student-programming/sessions/${sessionId}/messages`, {
                userId: user.id,
                content: payload.content,
                role: payload.role,
                sources: payload.sources,
                confidence: payload.confidence,
                modelUsed: payload.modelUsed,
            })
        );
        return response.data;
    }

    async getTutorGraphByJob(jobId: string) {
        try {
            const response = await firstValueFrom(
                this.httpService.get(`${this.aiServiceUrl}/tutor/graph/job/${jobId}`)
            );
            return response.data;
        } catch (error) {
            this.logger.error(`Tutor graph by job failed: ${error.message}`);
            throw new NotFoundException('Tutor graph theo job không tồn tại');
        }
    }

    async getTutorGraphByDocument(documentId: string) {
        try {
            const response = await firstValueFrom(
                this.httpService.get(`${this.aiServiceUrl}/tutor/graph/document/${documentId}`)
            );
            return response.data;
        } catch (error) {
            this.logger.error(`Tutor graph by document failed: ${error.message}`);
            throw new NotFoundException('Tutor graph theo document không tồn tại');
        }
    }

    async getTutorKnowledgeFileGraph(fileId: string) {
        try {
            const response = await firstValueFrom(
                this.httpService.get(`${this.aiServiceUrl}/tutor/knowledge-files/${fileId}/graph`)
            );
            return response.data;
        } catch (error) {
            this.logger.error(`Tutor graph by knowledge file failed: ${error.message}`);
            throw new NotFoundException('Graph tri thức theo file không tồn tại');
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
        let r2DeleteError: Error | null = null;

        // Delete file from R2 if keyR2 exists
        if (upload.keyR2) {
            try {
                await this.r2ClientService.deleteFile(upload.keyR2);
                this.logger.log(`Deleted file from R2: ${upload.keyR2}`);
            } catch (error) {
                r2DeleteError = error;
                this.logger.warn(
                    `Failed to delete file from R2: ${upload.keyR2} - ${error.message}`
                );
            }
        }

        try {
            const deletionResult = await this.aiRepository.deleteUploadAggregate(
                upload.id
            );
            this.logger.log(
                `Deleted upload aggregate for UserStorage: ${upload.id} (documents=${deletionResult.documents}, quizHistories=${deletionResult.quizHistories}, flashcardHistories=${deletionResult.flashcardHistories}, aiChatDocuments=${deletionResult.aiChatDocuments})`
            );
        } catch (error) {
            this.logger.error(
                `Failed to delete upload aggregate for UserStorage: ${upload.id} - ${error.message}`,
                error.stack
            );
            throw new InternalServerErrorException(
                'Không thể xóa dữ liệu upload khỏi hệ thống'
            );
        }

        await this.clearAiServiceCache(upload.id);

        if (r2DeleteError) {
            return {
                success: true,
                message:
                    'Đã xóa dữ liệu trong hệ thống nhưng không thể xóa file trên Cloudflare R2',
                warning: r2DeleteError.message,
            };
        }

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

        // Delete related Documents (embeddings) but keep uploaded file
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

        await this.clearAiServiceCache(upload.id);

        await this.aiRepository.updateUserStorageStatus(upload.id, 'PENDING');

        return {
            success: true,
            message: 'Đã hủy tác vụ và giữ lại file đã tải lên',
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
            dto.modelType,
            dto.isNarrowSearch ?? false,
            dto.keyword?.trim() || undefined
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
                this.normalizeTypeResult(dto.typeResult),
                dto.quantityQuizz || dto.count || 10,
                dto.quantityFlashcard || dto.count || 10,
                dto.modelType,
                dto.isNarrowSearch ?? false,
                dto.keyword?.trim() || undefined
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
            const normalizedTypeResult = this.normalizeTypeResult(dto.typeResult);
            const isFlashcard = normalizedTypeResult === 2;
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

            // Update status to PROCESSING so polling knows a job is running
            await this.aiRepository.updateUserStorageStatus(
                upload.id,
                'PROCESSING'
            );

            this.logger.log(
                `Triggering async AI generation for ${count} ${outputType} for upload ${upload.id}`
            );

            // Calculate specific quantities based on type
            const quantityQuizz = !isFlashcard ? count : 0;
            const quantityFlashcard = isFlashcard ? count : 0;

            // Fire and forget - reuse processFileAsync logic.
            // Pass ignoreProcessingStatusGuard=true because regenerate already claimed this job.
            this.processFileAsync(
                upload.id,
                user.id,
                normalizedTypeResult,
                quantityQuizz,
                quantityFlashcard,
                dto.modelType,
                dto.isNarrowSearch ?? false,
                dto.keyword?.trim() || undefined,
                true
            ).catch((err) =>
                this.logger.error(
                    `Background processing failed for regenerate ${upload.id}: ${err.message}`
                )
            );

            return {
                jobId: upload.id,
                status: 'processing',
                newBalance,
                message: isFlashcard
                    ? 'Đang tạo flashcard mới...'
                    : 'Đang tạo câu hỏi trắc nghiệm mới...',
            };
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

        // If currently processing/pending, do not return old history data
        const normalizedStatus =
            upload.processingStatus?.toLowerCase() || 'pending';
        if (normalizedStatus === 'processing' || normalizedStatus === 'pending') {
            return {
                jobId: upload.id,
                status: normalizedStatus,
                filename: upload.filename,
                createdAt: upload.createdAt,
            };
        }

        if (normalizedStatus === 'failed') {
            return {
                jobId: upload.id,
                status: 'failed',
                error: 'Model hiện tại không khả dụng, thử model khác.',
                filename: upload.filename,
                createdAt: upload.createdAt,
            };
        }

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

        // No result found
        return {
            jobId: upload.id,
            status: normalizedStatus,
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
