import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as FormData from 'form-data';

@Injectable()
export class OcrService {
    private readonly logger = new Logger(OcrService.name);
    private readonly pythonServiceUrl: string;

    constructor(private readonly httpService: HttpService) {
        // Python FastAPI service URL
        this.pythonServiceUrl =
            process.env.OCR_PYTHON_SERVICE_URL ||
            'http://127.0.0.1:8003/api/ocr';
    }

    /**
     * Xử lý OCR cho PDF bằng cách gọi Python service
     */
    async processPdf(
        pdfData: Buffer,
        filename: string,
        userId?: string,
    ): Promise<{
        jobId: string;
        content: string;
        pageCount: number;
    }> {
        try {
            // Tạo FormData để upload file
            const formData = new FormData();
            formData.append('file', pdfData, {
                filename: filename,
                contentType: 'application/pdf',
            });

            if (userId) {
                formData.append('user_id', userId);
            }

            // Gọi Python service
            const response = await firstValueFrom(
                this.httpService.post(
                    `${this.pythonServiceUrl}/process`,
                    formData,
                    {
                        headers: formData.getHeaders(),
                        timeout: 300000, // 5 minutes
                        maxContentLength: Infinity,
                        maxBodyLength: Infinity,
                    },
                ),
            );

            const data = response.data;

            if (!data.success) {
                throw new Error(
                    data.error_message || 'OCR processing failed',
                );
            }

            return {
                jobId: data.job_id,
                content: data.content,
                pageCount: data.page_count || 0,
            };
        } catch (error) {
            this.logger.error(
                `Error calling Python OCR service: ${error.message}`,
                error.stack,
            );

            if (error.response) {
                this.logger.error(`Response status: ${error.response.status}`);
                this.logger.error(`Response data: ${JSON.stringify(error.response.data)}`);
            }

            throw new Error(
                `Failed to process PDF: ${error.message}`,
            );
        }
    }

    /**
     * Kiểm tra health của Python service
     */
    async checkHealth(): Promise<{
        healthy: boolean;
        message: string;
    }> {
        try {
            const response = await firstValueFrom(
                this.httpService.get(
                    `${this.pythonServiceUrl.replace('/api/ocr', '')}/health`,
                    {
                        timeout: 5000,
                    },
                ),
            );

            return {
                healthy: response.data.healthy === true,
                message: response.data.message || 'OK',
            };
        } catch (error) {
            this.logger.error(
                `Health check failed: ${error.message}`,
            );

            return {
                healthy: false,
                message: `Python service unreachable: ${error.message}`,
            };
        }
    }
}
