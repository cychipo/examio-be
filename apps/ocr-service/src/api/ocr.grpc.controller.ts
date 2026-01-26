import { Controller, Logger } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { OcrService } from '../services/ocr.service';

// ==================== Request/Response Interfaces ====================

interface ProcessPdfRequest {
    pdfData: Buffer;
    filename: string;
    userId?: string;
}

interface ProcessPdfResponse {
    success: boolean;
    jobId: string;
    content: string;
    errorMessage: string;
    pageCount: number;
}

interface HealthCheckRequest {
    // Empty
}

interface HealthCheckResponse {
    healthy: boolean;
    message: string;
    version: string;
}

// ==================== Controller ====================

@Controller()
export class OcrGrpcController {
    private readonly logger = new Logger(OcrGrpcController.name);

    constructor(private readonly ocrService: OcrService) {}

    /**
     * Process PDF và trả về markdown content
     * Được gọi từ các service khác để xử lý OCR
     */
    @GrpcMethod('OcrService', 'ProcessPdf')
    async processPdf(
        request: ProcessPdfRequest,
    ): Promise<ProcessPdfResponse> {
        try {
            // Validate filename
            if (!request.filename) {
                return {
                    success: false,
                    jobId: '',
                    content: '',
                    errorMessage: 'Filename is required',
                    pageCount: 0,
                };
            }

            // Validate filename is PDF
            if (!request.filename.toLowerCase().endsWith('.pdf')) {
                return {
                    success: false,
                    jobId: '',
                    content: '',
                    errorMessage: 'Only PDF files are accepted',
                    pageCount: 0,
                };
            }

            // Validate pdfData exists
            if (!request.pdfData || request.pdfData.length === 0) {
                return {
                    success: false,
                    jobId: '',
                    content: '',
                    errorMessage: 'PDF data is empty',
                    pageCount: 0,
                };
            }

            this.logger.log(
                `Processing PDF: ${request.filename} (user: ${request.userId || 'N/A'}, size: ${request.pdfData.length} bytes)`,
            );

            const result = await this.ocrService.processPdf(
                request.pdfData,
                request.filename,
                request.userId,
            );

            this.logger.log(`PDF processed successfully: ${result.jobId}`);

            return {
                success: true,
                jobId: result.jobId,
                content: result.content,
                errorMessage: '',
                pageCount: result.pageCount,
            };
        } catch (error) {
            this.logger.error(
                `Error processing PDF: ${error.message}`,
                error.stack,
            );

            return {
                success: false,
                jobId: '',
                content: '',
                errorMessage: error.message || 'Unknown error',
                pageCount: 0,
            };
        }
    }

    /**
     * Health check endpoint cho OCR service
     */
    @GrpcMethod('OcrService', 'HealthCheck')
    async healthCheck(
        request: HealthCheckRequest,
    ): Promise<HealthCheckResponse> {
        try {
            const health = await this.ocrService.checkHealth();

            return {
                healthy: health.healthy,
                message: health.message,
                version: '1.0.0',
            };
        } catch (error) {
            this.logger.error(`Health check failed: ${error.message}`);

            return {
                healthy: false,
                message: error.message || 'Service unhealthy',
                version: '1.0.0',
            };
        }
    }
}
