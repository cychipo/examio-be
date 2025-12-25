import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { Observable, lastValueFrom } from 'rxjs';
import { R2_SERVICE } from './grpc-clients.module';

// gRPC interfaces based on r2.proto
export interface UploadFileRequest {
    fileName: string;
    fileData: Uint8Array;
    contentType: string;
    folder: string;
}

export interface UploadFileResponse {
    success: boolean;
    key: string;
    url: string;
    message: string;
}

export interface GetFileRequest {
    key: string;
}

export interface GetFileResponse {
    success: boolean;
    fileData: Uint8Array;
    contentType: string;
    message: string;
}

export interface DeleteFileRequest {
    key: string;
}

export interface DeleteFileResponse {
    success: boolean;
    message: string;
}

export interface GetUrlRequest {
    key: string;
}

export interface GetUrlResponse {
    url: string;
}

export interface R2ServiceGrpc {
    uploadFile(request: UploadFileRequest): Observable<UploadFileResponse>;
    getFile(request: GetFileRequest): Observable<GetFileResponse>;
    deleteFile(request: DeleteFileRequest): Observable<DeleteFileResponse>;
    getPublicUrl(request: GetUrlRequest): Observable<GetUrlResponse>;
}

/**
 * R2ClientService - Wrapper để gọi R2 Service qua gRPC
 * Cung cấp Promise-based interface giống với R2Service local
 */
@Injectable()
export class R2ClientService implements OnModuleInit {
    private r2Service: R2ServiceGrpc;

    constructor(@Inject(R2_SERVICE) private readonly client: ClientGrpc) {}

    onModuleInit() {
        this.r2Service = this.client.getService<R2ServiceGrpc>('R2Service');
    }

    /**
     * Upload file lên R2
     */
    async uploadFile(
        fileName: string,
        fileData: Buffer,
        contentType: string,
        folder: string
    ): Promise<string> {
        const response = await lastValueFrom(
            this.r2Service.uploadFile({
                fileName,
                fileData: new Uint8Array(fileData),
                contentType,
                folder,
            })
        );

        if (!response.success) {
            throw new Error(response.message || 'Upload failed');
        }

        return response.key;
    }

    /**
     * Lấy file từ R2
     */
    async getFile(key: string): Promise<Buffer> {
        const response = await lastValueFrom(this.r2Service.getFile({ key }));

        if (!response.success) {
            throw new Error(response.message || 'Get file failed');
        }

        return Buffer.from(response.fileData);
    }

    /**
     * Xóa file từ R2
     */
    async deleteFile(key: string): Promise<void> {
        const response = await lastValueFrom(
            this.r2Service.deleteFile({ key })
        );

        if (!response.success) {
            console.warn(`Failed to delete file: ${response.message}`);
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
