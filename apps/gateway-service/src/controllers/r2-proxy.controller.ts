import {
    Controller,
    Post,
    Req,
    UseInterceptors,
    UploadedFile,
    Logger,
    BadRequestException,
    InternalServerErrorException,
} from '@nestjs/common';
import {
    ApiTags,
    ApiOperation,
    ApiBearerAuth,
    ApiConsumes,
    ApiResponse,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as FormData from 'form-data';

@ApiTags('R2 Storage')
@Controller('r2')
@ApiBearerAuth('access-token')
export class R2ProxyController {
    private readonly logger = new Logger(R2ProxyController.name);

    constructor(private readonly httpService: HttpService) {}

    @Post('image')
    @UseInterceptors(FileInterceptor('file'))
    @ApiOperation({ summary: 'Upload image to R2 storage' })
    @ApiConsumes('multipart/form-data')
    @ApiResponse({ status: 201, description: 'Image uploaded successfully' })
    async uploadImage(
        @Req() req: Request,
        @UploadedFile() file: Express.Multer.File
    ) {
        this.logger.log('--- GATEWAY: R2 IMAGE UPLOAD REQUEST ---');
        this.logger.log(
            `File received: ${file ? `${file.originalname} (${file.size} bytes, ${file.mimetype})` : 'MISSING'}`
        );

        if (!file || !file.buffer) {
            this.logger.error('No file received in gateway');
            throw new BadRequestException('No file uploaded');
        }

        // Validate file type
        if (!file.mimetype.startsWith('image/')) {
            throw new BadRequestException('Only image files are allowed');
        }

        // Validate file size (max 2MB)
        const maxSize = 2 * 1024 * 1024;
        if (file.size > maxSize) {
            throw new BadRequestException(
                `File too large. Maximum size is 2MB, got ${(file.size / (1024 * 1024)).toFixed(2)}MB`
            );
        }

        // Forward file to exam-service for R2 upload
        const formData = new FormData();
        formData.append('file', file.buffer, {
            filename: file.originalname,
            contentType: file.mimetype,
        });

        const examServiceUrl =
            process.env.EXAM_SERVICE_URL || 'http://localhost:3002';

        try {
            const token = this.extractToken(req);
            const response = await firstValueFrom(
                this.httpService.post(
                    `${examServiceUrl}/api/v1/r2/image`,
                    formData,
                    {
                        headers: {
                            ...formData.getHeaders(),
                            Authorization: token ? `Bearer ${token}` : '',
                        },
                        timeout: 30000, // 30 seconds
                    }
                )
            );
            return response.data;
        } catch (error) {
            this.logger.error(
                `R2 image upload failed: ${error.message}`,
                error.response?.data
            );
            const errorMessage = error.response?.data?.message || error.message;
            throw new InternalServerErrorException(
                `Upload failed: ${errorMessage}`
            );
        }
    }

    private extractToken(req: Request): string | undefined {
        // Try Authorization header first
        const authHeader = req.headers.authorization;
        if (authHeader?.startsWith('Bearer ')) {
            return authHeader.substring(7);
        }
        // Fallback to cookie
        return (req as any).cookies?.token;
    }
}
