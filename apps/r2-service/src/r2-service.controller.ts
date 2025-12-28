import { Controller, Logger } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { R2ServiceService } from './r2-service.service';

// gRPC DTOs matching the proto file
interface UploadFileRequest {
    user_id: string;
    filename: string;
    mimetype: string;
    content: Buffer;
    folder?: string;
}

interface GetFileUrlRequest {
    key_r2: string;
    expires_in_seconds?: number;
}

interface DeleteFileRequest {
    key_r2: string;
}

@Controller()
export class R2ServiceController {
    private readonly logger = new Logger(R2ServiceController.name);

    constructor(private readonly r2Service: R2ServiceService) {}

    @GrpcMethod('R2Service', 'UploadFile')
    async uploadFile(data: UploadFileRequest) {
        this.logger.log(
            `UploadFile request: filename=${data.filename}, mimetype=${data.mimetype}, folder=${data.folder}, contentSize=${data.content?.length || 0}`
        );

        try {
            const key = await this.r2Service.uploadFile(
                data.filename,
                Buffer.from(data.content),
                data.mimetype,
                data.folder
            );

            this.logger.log(`UploadFile success: key=${key}`);

            return {
                success: true,
                file_id: key,
                url: this.r2Service.getPublicUrl(key),
                key_r2: key,
                message: 'File uploaded successfully',
            };
        } catch (error) {
            this.logger.error(
                `UploadFile failed: ${error.message}`,
                error.stack
            );
            return {
                success: false,
                message: `Upload failed: ${error.message}`,
            };
        }
    }

    @GrpcMethod('R2Service', 'GetFileUrl')
    async getFileUrl(data: GetFileUrlRequest) {
        const url = this.r2Service.getPublicUrl(data.key_r2);
        return {
            url,
            expires_at: Date.now() + (data.expires_in_seconds || 3600) * 1000,
        };
    }

    @GrpcMethod('R2Service', 'DeleteFile')
    async deleteFile(data: DeleteFileRequest) {
        try {
            await this.r2Service.deleteFile(data.key_r2);
            return {
                success: true,
                message: 'File deleted successfully',
            };
        } catch (error) {
            return {
                success: false,
                message: `Delete failed: ${error.message}`,
            };
        }
    }
}
