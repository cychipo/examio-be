import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { User } from '@prisma/client';
import {
    GenerateIdService,
    EventPublisherService,
    EventType,
    OcrRequestedPayload,
} from '@examio/common';
import { AIRepository } from './ai.repository';
import { UploadFileDto, RegenerateDto } from './dto/ai.dto';

@Injectable()
export class AIService {
    private readonly logger = new Logger(AIService.name);

    constructor(
        private readonly aiRepository: AIRepository,
        private readonly generateIdService: GenerateIdService,
        private readonly eventPublisher: EventPublisherService
    ) {}

    /**
     * Get recent uploads for a user
     */
    async getRecentUploads(user: User, page = 1, size = 10) {
        const result = await this.aiRepository.findUserStoragesByUserId(
            user.id,
            { page, size }
        );

        return {
            data: result.data,
            total: result.total,
            page,
            size,
            totalPages: Math.ceil(result.total / size),
        };
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
            message: 'File đã được upload, đang xử lý OCR',
        };
    }

    /**
     * Regenerate quiz/flashcard from an existing upload
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
                id: upload.id,
                status: 'PROCESSING',
                message: 'Đang xử lý OCR, vui lòng thử lại sau',
            };
        }

        if (upload.processingStatus === 'FAILED') {
            throw new NotFoundException(
                'File xử lý thất bại, vui lòng upload lại'
            );
        }

        // File is processed, return info for frontend to call AI service
        return {
            id: upload.id,
            status: upload.processingStatus,
            outputType: dto.outputType || 'quiz',
            count: dto.count || 10,
            message: 'File đã sẵn sàng để tạo nội dung',
        };
    }

    /**
     * Get job status (check processing status)
     */
    async getJobStatus(jobId: string, user: User) {
        const upload = await this.getUploadDetail(jobId, user);
        return {
            id: upload.id,
            status: upload.processingStatus,
            filename: upload.filename,
            createdAt: upload.createdAt,
        };
    }
}
