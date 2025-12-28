import { Injectable, Inject, OnModuleInit, Logger } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { Observable, lastValueFrom } from 'rxjs';
import { R2_SERVICE } from './grpc-clients.module';

// gRPC interfaces matching r2.proto (use snake_case as per proto)
export interface UploadFileRequest {
    user_id?: string;
    filename: string;
    mimetype: string;
    content: Uint8Array;
    folder?: string;
}

export interface UploadFileResponse {
    success: boolean;
    file_id: string;
    fileId?: string; // camelCase variant
    url: string;
    key_r2: string;
    keyR2?: string; // camelCase variant
    message: string;
}

export interface GetFileUrlRequest {
    key_r2: string;
    expires_in_seconds?: number;
}

export interface GetFileUrlResponse {
    url: string;
    expires_at: number;
}

export interface DeleteFileRequest {
    key_r2: string;
}

export interface DeleteFileResponse {
    success: boolean;
    message: string;
}

export interface R2ServiceGrpc {
    uploadFile(request: UploadFileRequest): Observable<UploadFileResponse>;
    getFileUrl(request: GetFileUrlRequest): Observable<GetFileUrlResponse>;
    deleteFile(request: DeleteFileRequest): Observable<DeleteFileResponse>;
}

/**
 * R2ClientService - Wrapper để gọi R2 Service qua gRPC
 * Cung cấp Promise-based interface giống với R2Service local
 */
@Injectable()
export class R2ClientService implements OnModuleInit {
    private readonly logger = new Logger(R2ClientService.name);
    private r2Service: R2ServiceGrpc;

    constructor(@Inject(R2_SERVICE) private readonly client: ClientGrpc) {}

    onModuleInit() {
        this.r2Service = this.client.getService<R2ServiceGrpc>('R2Service');
        this.logger.log('R2ClientService initialized');
    }

    /**
     * Upload file lên R2
     * @param filename - Tên file
     * @param fileData - Buffer chứa nội dung file
     * @param mimetype - MIME type của file
     * @param folder - Folder lưu file (optional)
     * @returns key_r2 - Key của file trên R2
     */
    async uploadFile(
        filename: string,
        fileData: Buffer,
        mimetype: string,
        folder?: string
    ): Promise<string> {
        this.logger.log(`Uploading file: ${filename} to folder: ${folder}`);

        try {
            const response = await lastValueFrom(
                this.r2Service.uploadFile({
                    filename,
                    content: new Uint8Array(fileData),
                    mimetype,
                    folder: folder || '',
                })
            );

            this.logger.log(
                `Upload response: success=${response.success}, key_r2=${response.key_r2}, keyR2=${response.keyR2}, file_id=${response.file_id}, fileId=${response.fileId}, url=${response.url}`
            );

            if (!response.success) {
                throw new Error(response.message || 'Upload failed');
            }

            // Return key_r2 (or camelCase keyR2), fallback to file_id/fileId if empty
            let key =
                response.key_r2 ||
                response.keyR2 ||
                response.file_id ||
                response.fileId;

            // If key is still empty, try to extract from URL
            // URL format: https://examio-r2.fayedark.com/ai-teacher/filename.pdf
            if (!key && response.url) {
                const r2PublicUrl =
                    process.env.R2_PUBLIC_URL || 'https://r2.examio.com';
                // Try multiple possible base URLs
                const possibleBaseUrls = [
                    r2PublicUrl,
                    'https://examio-r2.fayedark.com',
                    'https://r2.examio.com',
                ];

                for (const baseUrl of possibleBaseUrls) {
                    if (response.url.startsWith(baseUrl)) {
                        key = response.url.replace(`${baseUrl}/`, '');
                        this.logger.log(
                            `Extracted key from URL: ${key} (baseUrl: ${baseUrl})`
                        );
                        break;
                    }
                }
            }

            if (!key) {
                this.logger.error(
                    `Full response object: ${JSON.stringify(response)}`
                );
                throw new Error('R2 service returned empty key');
            }

            return key;
        } catch (error) {
            this.logger.error(`Upload failed: ${error.message}`, error.stack);
            throw error;
        }
    }

    /**
     * Xóa file từ R2
     */
    async deleteFile(key_r2: string): Promise<void> {
        const response = await lastValueFrom(
            this.r2Service.deleteFile({ key_r2 })
        );

        if (!response.success) {
            this.logger.warn(`Failed to delete file: ${response.message}`);
        }
    }

    /**
     * Lấy public URL của file
     */
    getPublicUrl(key: string): string {
        // Trả về URL trực tiếp dựa trên key
        // Có thể cấu hình domain từ environment
        const r2PublicUrl =
            process.env.R2_PUBLIC_URL || 'https://r2.examio.com';
        return `${r2PublicUrl}/${key}`;
    }
}
