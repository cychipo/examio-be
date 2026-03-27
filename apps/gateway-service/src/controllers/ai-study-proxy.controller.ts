import {
    Controller,
    Get,
    Post,
    Put,
    Patch,
    Delete,
    Param,
    Body,
    Query,
    Req,
    UseGuards,
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
    ApiQuery,
    ApiConsumes,
    ApiCookieAuth,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { ProxyService } from '../services/proxy.service';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as FormData from 'form-data';
import { AuthGuard, Roles, RolesGuard } from '@examio/common';

// ==================== AI ====================

@ApiTags('AI')
@Controller('ai')
@UseGuards(AuthGuard, RolesGuard)
@Roles('teacher', 'student')
@ApiBearerAuth('access-token')
@ApiCookieAuth('cookie-auth')
export class AIProxyController {
    private readonly logger = new Logger(AIProxyController.name);

    constructor(
        private readonly proxyService: ProxyService,
        private readonly httpService: HttpService
    ) {}

    @Post('quick-upload')
    @UseInterceptors(FileInterceptor('file'))
    @ApiOperation({ summary: 'Quick upload file cho AI Teacher' })
    @ApiConsumes('multipart/form-data')
    async quickUpload(
        @Req() req: Request,
        @UploadedFile() file: Express.Multer.File
    ) {
        this.logger.log('--- GATEWAY: QUICK UPLOAD REQUEST ---');
        this.logger.log(
            `File received: ${file ? `${file.originalname} (${file.size} bytes)` : 'MISSING'}`
        );

        if (!file || !file.buffer) {
            this.logger.error('No file received in gateway');
            throw new BadRequestException('No file uploaded');
        }

        // Forward file to exam-service
        const formData = new FormData();
        formData.append('file', file.buffer, {
            filename: file.originalname,
            contentType: file.mimetype,
        });

        const examServiceUrl =
            process.env.EXAM_SERVICE_URL || 'http://localhost:3002';

        try {
            // Increase timeout for file upload (120 seconds)
            const response = await firstValueFrom(
                this.httpService.post(
                    `${examServiceUrl}/api/v1/ai/quick-upload`,
                    formData,
                    {
                        headers: {
                            ...formData.getHeaders(),
                            Authorization: `Bearer ${this.t(req)}`,
                        },
                        timeout: 120000, // 2 minutes for large file uploads
                    }
                )
            );
            return response.data;
        } catch (error) {
            this.logger.error(
                `Quick upload failed: ${error.message}`,
                error.response?.data
            );
            // Re-throw with proper error message from exam-service
            const errorMessage = error.response?.data?.message || error.message;
            throw new InternalServerErrorException(
                `Upload failed: ${errorMessage}`
            );
        }
    }

    @Post('generate-from-file')
    @UseInterceptors(FileInterceptor('file'))
    @ApiOperation({ summary: 'Upload file và tạo quiz/flashcard' })
    @ApiConsumes('multipart/form-data')
    async generateFromFile(
        @Req() req: Request,
        @UploadedFile() file: Express.Multer.File,
        @Body() body: any
    ) {
        this.logger.log('--- GATEWAY: GENERATE FROM FILE REQUEST ---');
        this.logger.log(
            `File received: ${file ? `${file.originalname} (${file.size} bytes)` : 'MISSING'}`
        );

        if (!file || !file.buffer) {
            this.logger.error('No file received in gateway');
            throw new BadRequestException('No file uploaded');
        }

        // Forward file to exam-service with form data
        const formData = new FormData();
        formData.append('file', file.buffer, {
            filename: file.originalname,
            contentType: file.mimetype,
        });
        // Append other form fields
        console.log('Gateway generate-from-file body:', JSON.stringify(body));

        if (body.typeResult) formData.append('typeResult', body.typeResult);

        // Handle both spelling variants for quiz quantity
        if (body.quantityQuizz) {
            formData.append('quantityQuizz', body.quantityQuizz);
        } else if (body.quantityQuiz) {
            formData.append('quantityQuizz', body.quantityQuiz); // Normalize to 2 'z's for exam-service
        }

        if (body.quantityFlashcard)
            formData.append('quantityFlashcard', body.quantityFlashcard);
        if (body.isNarrowSearch)
            formData.append('isNarrowSearch', body.isNarrowSearch);
        if (body.keyword) formData.append('keyword', body.keyword);
        if (body.modelType) formData.append('modelType', body.modelType);

        const examServiceUrl =
            process.env.EXAM_SERVICE_URL || 'http://localhost:3002';

        try {
            // Increase timeout for file upload (120 seconds)
            const response = await firstValueFrom(
                this.httpService.post(
                    `${examServiceUrl}/api/v1/ai/generate-from-file`,
                    formData,
                    {
                        headers: {
                            ...formData.getHeaders(),
                            Authorization: `Bearer ${this.t(req)}`,
                        },
                        timeout: 120000, // 2 minutes for large file uploads
                    }
                )
            );
            return response.data;
        } catch (error) {
            this.logger.error(
                `Generate from file failed: ${error.message}`,
                error.response?.data
            );
            const errorMessage = error.response?.data?.message || error.message;
            throw new InternalServerErrorException(
                `Generate from file failed: ${errorMessage}`
            );
        }
    }

    @Get('recent-uploads')
    @ApiOperation({ summary: 'Lấy danh sách file đã upload' })
    async getRecentUploads(@Req() req: Request, @Query() query: any) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: '/api/v1/ai/recent-uploads',
                query,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get('models')
    @ApiOperation({ summary: 'Lấy catalog model AI' })
    async getModels(@Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: '/api/v1/ai/models',
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Post('tutor/ingest')
    @ApiOperation({ summary: 'Tạo tutor ingest job' })
    async tutorIngest(@Body() body: any, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'POST',
                path: '/api/v1/ai/tutor/ingest',
                body,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Post('tutor/knowledge-files')
    @UseInterceptors(FileInterceptor('file'))
    @ApiOperation({ summary: 'Upload file tri thức cho tutor' })
    @ApiConsumes('multipart/form-data')
    async uploadTutorKnowledgeFile(
        @Req() req: Request,
        @UploadedFile() file: Express.Multer.File,
        @Body() body: any
    ) {
        if (!file || !file.buffer) {
            throw new BadRequestException('No file uploaded');
        }

        const formData = new FormData();
        formData.append('file', file.buffer, {
            filename: file.originalname,
            contentType: file.mimetype,
        });

        if (body.folderId) formData.append('folderId', body.folderId);
        if (body.folderName) formData.append('folderName', body.folderName);
        if (body.folderDescription) formData.append('folderDescription', body.folderDescription);
        if (body.courseCode) formData.append('courseCode', body.courseCode);
        if (body.language) formData.append('language', body.language);
        if (body.topic) formData.append('topic', body.topic);
        if (body.difficulty) formData.append('difficulty', body.difficulty);

        const examServiceUrl = process.env.EXAM_SERVICE_URL || 'http://localhost:3002';
        const response = await firstValueFrom(
            this.httpService.post(
                `${examServiceUrl}/api/v1/ai/tutor/knowledge-files`,
                formData,
                {
                    headers: {
                        ...formData.getHeaders(),
                        Authorization: `Bearer ${this.t(req)}`,
                    },
                    timeout: 120000,
                }
            )
        );

        return response.data;
    }

    @Post('tutor/knowledge-folders')
    @ApiOperation({ summary: 'Tạo folder tri thức tutor' })
    async createTutorKnowledgeFolder(@Body() body: any, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'POST',
                path: '/api/v1/ai/tutor/knowledge-folders',
                body,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Put('tutor/knowledge-folders/:folderId')
    @ApiOperation({ summary: 'Cập nhật folder tri thức tutor' })
    async updateTutorKnowledgeFolder(
        @Param('folderId') folderId: string,
        @Body() body: any,
        @Req() req: Request
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'PUT',
                path: `/api/v1/ai/tutor/knowledge-folders/${folderId}`,
                body,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Delete('tutor/knowledge-folders/:folderId')
    @ApiOperation({ summary: 'Xóa folder tri thức tutor' })
    async deleteTutorKnowledgeFolder(@Param('folderId') folderId: string, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'DELETE',
                path: `/api/v1/ai/tutor/knowledge-folders/${folderId}`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get('tutor/knowledge-folders/:folderId/contents')
    @ApiOperation({ summary: 'Lấy folder contents tri thức tutor' })
    async getTutorKnowledgeFolderContents(@Param('folderId') folderId: string, @Req() req: Request) {
        const queryString = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: `/api/v1/ai/tutor/knowledge-folders/${folderId}/contents${queryString}`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get('tutor/knowledge-folders')
    @ApiOperation({ summary: 'Lấy danh sách folder tri thức tutor' })
    async listTutorKnowledgeFolders(@Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: '/api/v1/ai/tutor/knowledge-folders',
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get('tutor/dataset-imports/catalog')
    @ApiOperation({ summary: 'Lấy catalog dataset tutor' })
    async listTutorDatasetCatalog(@Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: '/api/v1/ai/tutor/dataset-imports/catalog',
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Post('tutor/dataset-imports')
    @ApiOperation({ summary: 'Tạo job nạp dataset tutor' })
    async createTutorDatasetImport(@Body() body: any, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'POST',
                path: '/api/v1/ai/tutor/dataset-imports',
                body,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get('tutor/dataset-imports')
    @ApiOperation({ summary: 'Lấy danh sách job nạp dataset tutor' })
    async listTutorDatasetImports(@Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: '/api/v1/ai/tutor/dataset-imports',
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get('tutor/dataset-imports/:jobId')
    @ApiOperation({ summary: 'Lấy trạng thái job nạp dataset tutor' })
    async getTutorDatasetImportJob(@Param('jobId') jobId: string, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: `/api/v1/ai/tutor/dataset-imports/${jobId}`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Post('tutor/dataset-imports/:jobId/cancel')
    @ApiOperation({ summary: 'Hủy job nạp dataset tutor' })
    async cancelTutorDatasetImportJob(@Param('jobId') jobId: string, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'POST',
                path: `/api/v1/ai/tutor/dataset-imports/${jobId}/cancel`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get('tutor/knowledge-stats')
    @ApiOperation({ summary: 'Lấy thống kê kho tri thức tutor' })
    async getTutorKnowledgeStats(@Req() req: Request) {
        const queryString = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: `/api/v1/ai/tutor/knowledge-stats${queryString}`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get('tutor/knowledge-files')
    @ApiOperation({ summary: 'Lấy danh sách file tri thức tutor' })
    async listTutorKnowledgeFiles(@Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: '/api/v1/ai/tutor/knowledge-files',
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get('tutor/knowledge-files/search')
    @ApiOperation({ summary: 'Filter/search/sort file tri thức tutor' })
    async searchTutorKnowledgeFiles(@Req() req: Request) {
        const queryString = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: `/api/v1/ai/tutor/knowledge-files/search${queryString}`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get('tutor/knowledge-files/:fileId')
    @ApiOperation({ summary: 'Lấy trạng thái file tri thức tutor' })
    async getTutorKnowledgeFileStatus(@Param('fileId') fileId: string, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: `/api/v1/ai/tutor/knowledge-files/${fileId}`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Delete('tutor/knowledge-files/:fileId')
    @ApiOperation({ summary: 'Xóa file tri thức tutor' })
    async deleteTutorKnowledgeFile(@Param('fileId') fileId: string, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'DELETE',
                path: `/api/v1/ai/tutor/knowledge-files/${fileId}`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Post('tutor/knowledge-files/:fileId/reprocess')
    @ApiOperation({ summary: 'Reprocess file tri thức tutor' })
    async reprocessTutorKnowledgeFile(@Param('fileId') fileId: string, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'POST',
                path: `/api/v1/ai/tutor/knowledge-files/${fileId}/reprocess`,
                headers: this.h(req),
                body: {},
            },
            this.t(req)
        );
    }

    @Post('tutor/knowledge-files/bulk-delete')
    @ApiOperation({ summary: 'Bulk delete file tri thức tutor' })
    async bulkDeleteTutorKnowledgeFiles(@Body() body: any, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'POST',
                path: '/api/v1/ai/tutor/knowledge-files/bulk-delete',
                headers: this.h(req),
                body,
            },
            this.t(req)
        );
    }

    @Post('tutor/knowledge-files/bulk-reprocess')
    @ApiOperation({ summary: 'Bulk reprocess file tri thức tutor' })
    async bulkReprocessTutorKnowledgeFiles(@Body() body: any, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'POST',
                path: '/api/v1/ai/tutor/knowledge-files/bulk-reprocess',
                headers: this.h(req),
                body,
            },
            this.t(req)
        );
    }

    @Get('tutor/ingest')
    @ApiOperation({ summary: 'Lấy danh sách tutor ingest jobs' })
    async listTutorIngestJobs(@Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: '/api/v1/ai/tutor/ingest',
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get('tutor/ingest/:jobId')
    @ApiOperation({ summary: 'Lấy chi tiết tutor ingest job' })
    async getTutorIngestJob(@Param('jobId') jobId: string, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: `/api/v1/ai/tutor/ingest/${jobId}`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Post('tutor/query')
    @ApiOperation({ summary: 'Hỏi tutor' })
    async tutorQuery(@Body() body: any, @Req() req: Request) {
        return this.proxyService.forwardWithAuthAndTimeout(
            'exam',
            {
                method: 'POST',
                path: '/api/v1/ai/tutor/query',
                body,
                headers: this.h(req),
            },
            this.t(req),
            300000
        );
    }

    @Post('tutor/stream')
    @ApiOperation({ summary: 'Hỏi tutor với streaming' })
    async tutorStream(@Body() body: any, @Req() req: Request) {
        return this.proxyService.forwardWithAuthAndTimeout(
            'exam',
            {
                method: 'POST',
                path: '/api/v1/ai/tutor/stream',
                body,
                headers: this.h(req),
            },
            this.t(req),
            300000
        );
    }

    @Get('tutor/graph/job/:jobId')
    @ApiOperation({ summary: 'Xem tutor graph theo job' })
    async getTutorGraphByJob(@Param('jobId') jobId: string, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: `/api/v1/ai/tutor/graph/job/${jobId}`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get('tutor/graph/document/:documentId')
    @ApiOperation({ summary: 'Xem tutor graph theo document' })
    async getTutorGraphByDocument(
        @Param('documentId') documentId: string,
        @Req() req: Request
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: `/api/v1/ai/tutor/graph/document/${documentId}`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get('tutor/knowledge-files/:fileId/graph')
    @ApiOperation({ summary: 'Xem graph theo file tri thức tutor' })
    async getTutorKnowledgeFileGraph(
        @Param('fileId') fileId: string,
        @Req() req: Request
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: `/api/v1/ai/tutor/knowledge-files/${fileId}/graph`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get('upload/:uploadId')
    @ApiOperation({ summary: 'Lấy chi tiết file đã upload' })
    async getUploadDetail(
        @Param('uploadId') uploadId: string,
        @Req() req: Request
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: `/api/v1/ai/upload/${uploadId}`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Delete('upload/:uploadId')
    @ApiOperation({ summary: 'Xóa file upload' })
    async deleteUpload(
        @Param('uploadId') uploadId: string,
        @Req() req: Request
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'DELETE',
                path: `/api/v1/ai/upload/${uploadId}`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get('upload/:uploadId/history')
    @ApiOperation({
        summary: 'Lấy lịch sử quiz và flashcard đã tạo cho một file',
    })
    async getUploadHistory(
        @Param('uploadId') uploadId: string,
        @Req() req: Request
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: `/api/v1/ai/upload/${uploadId}/history`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Post('regenerate/:uploadId')
    @ApiOperation({ summary: 'Tạo lại quiz/flashcard từ file' })
    async regenerate(
        @Param('uploadId') uploadId: string,
        @Body() body: any,
        @Req() req: Request
    ) {
        // Use extended timeout for Ollama model requests
        return this.proxyService.forwardWithAuthAndTimeout(
            'exam',
            {
                method: 'POST',
                path: `/api/v1/ai/regenerate/${uploadId}`,
                body,
                headers: this.h(req),
            },
            this.t(req),
            600000 // 10 min timeout for Ollama
        );
    }

    @Get('job/:jobId')
    @ApiOperation({ summary: 'Lấy trạng thái job' })
    async getJobStatus(@Param('jobId') jobId: string, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: `/api/v1/ai/job/${jobId}`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Delete('job/:jobId')
    @ApiOperation({ summary: 'Hủy job' })
    async cancelJob(@Param('jobId') jobId: string, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'DELETE',
                path: `/api/v1/ai/job/${jobId}`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Post('upload-image')
    @ApiOperation({ summary: 'Upload image cho AI chat' })
    async uploadImage(@Body() body: any, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'POST',
                path: '/api/v1/ai/upload-image',
                body,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    private h(req: Request) {
        return { 'user-agent': req.headers['user-agent'] || '' };
    }
    private t(req: Request) {
        const a = req.headers.authorization;
        return a?.startsWith('Bearer ')
            ? a.substring(7)
            : req.cookies?.token || req.cookies?.accessToken || '';
    }
}

// ==================== AI CHAT ====================

@ApiTags('AI Chat')
@Controller('ai-chat')
@UseGuards(AuthGuard, RolesGuard)
@Roles('teacher', 'student')
@ApiBearerAuth('access-token')
@ApiCookieAuth('cookie-auth')
export class AIChatProxyController {
    constructor(private readonly proxyService: ProxyService) {}

    @Get()
    @ApiOperation({ summary: 'Lấy danh sách chats' })
    async getChats(@Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            { method: 'GET', path: '/api/v1/ai-chat', headers: this.h(req) },
            this.t(req)
        );
    }

    @Post()
    @ApiOperation({ summary: 'Tạo chat mới' })
    async createChat(@Body() body: any, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'POST',
                path: '/api/v1/ai-chat',
                body,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get(':chatId/messages')
    @ApiOperation({ summary: 'Lấy messages của chat' })
    async getMessages(@Param('chatId') chatId: string, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: `/api/v1/ai-chat/${chatId}/messages`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Post(':chatId/message')
    @ApiOperation({ summary: 'Gửi message' })
    async sendMessage(
        @Param('chatId') chatId: string,
        @Body() body: any,
        @Req() req: Request
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'POST',
                path: `/api/v1/ai-chat/${chatId}/message`,
                body,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Post(':chatId/stream')
    @ApiOperation({ summary: 'Gửi message với streaming' })
    async streamMessage(
        @Param('chatId') chatId: string,
        @Body() body: any,
        @Req() req: Request
    ) {
        // Use extended timeout for AI streaming (5 minutes)
        return this.proxyService.forwardWithAuthAndTimeout(
            'exam',
            {
                method: 'POST',
                path: `/api/v1/ai-chat/${chatId}/stream`,
                body,
                headers: this.h(req),
            },
            this.t(req),
            300000 // 5 minutes timeout for AI streaming
        );
    }

    @Get(':chatId/exists')
    @ApiOperation({ summary: 'Check chat exists' })
    async chatExists(@Param('chatId') chatId: string, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: `/api/v1/ai-chat/${chatId}/exists`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Delete(':chatId')
    @ApiOperation({ summary: 'Xóa chat' })
    async deleteChat(@Param('chatId') chatId: string, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'DELETE',
                path: `/api/v1/ai-chat/${chatId}`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    // Documents
    @Get(':chatId/documents')
    @ApiOperation({ summary: 'Lấy documents của chat' })
    async getDocuments(@Param('chatId') chatId: string, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: `/api/v1/ai-chat/${chatId}/documents`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Post(':chatId/documents')
    @ApiOperation({ summary: 'Thêm document vào chat' })
    async addDocument(
        @Param('chatId') chatId: string,
        @Body() body: any,
        @Req() req: Request
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'POST',
                path: `/api/v1/ai-chat/${chatId}/documents`,
                body,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Delete(':chatId/documents/:documentId')
    @ApiOperation({ summary: 'Xóa document khỏi chat' })
    async removeDocument(
        @Param('chatId') chatId: string,
        @Param('documentId') documentId: string,
        @Req() req: Request
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'DELETE',
                path: `/api/v1/ai-chat/${chatId}/documents/${documentId}`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    // Messages
    @Delete('message/:messageId')
    @ApiOperation({ summary: 'Xóa message' })
    async deleteMessage(
        @Param('messageId') messageId: string,
        @Req() req: Request
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'DELETE',
                path: `/api/v1/ai-chat/message/${messageId}`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Post('message/:messageId/regenerate')
    @ApiOperation({ summary: 'Regenerate response' })
    async regenerateMessage(
        @Param('messageId') messageId: string,
        @Req() req: Request
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'POST',
                path: `/api/v1/ai-chat/message/${messageId}/regenerate`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Post('message/:messageId/regenerate-stream')
    @ApiOperation({ summary: 'Regenerate response với streaming' })
    async regenerateMessageStream(
        @Param('messageId') messageId: string,
        @Req() req: Request
    ) {
        // Use extended timeout for AI streaming (5 minutes)
        return this.proxyService.forwardWithAuthAndTimeout(
            'exam',
            {
                method: 'POST',
                path: `/api/v1/ai-chat/message/${messageId}/regenerate-stream`,
                headers: this.h(req),
            },
            this.t(req),
            300000 // 5 minutes timeout for AI streaming
        );
    }

    @Patch('message/:messageId')
    @ApiOperation({ summary: 'Cập nhật message' })
    async updateMessage(
        @Param('messageId') messageId: string,
        @Body() body: any,
        @Req() req: Request
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'PATCH',
                path: `/api/v1/ai-chat/message/${messageId}`,
                body,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    private h(req: Request) {
        return { 'user-agent': req.headers['user-agent'] || '' };
    }
    private t(req: Request) {
        const a = req.headers.authorization;
        return a?.startsWith('Bearer ')
            ? a.substring(7)
            : req.cookies?.token || req.cookies?.accessToken || '';
    }
}

// ==================== FLASHCARD STUDY ====================

@ApiTags('Flashcard Study')
@Controller('flashcard-study')
@ApiBearerAuth('access-token')
export class FlashcardStudyProxyController {
    constructor(private readonly proxyService: ProxyService) {}

    @Post('session')
    @ApiOperation({ summary: 'Get or create study session' })
    async getOrCreateSession(@Body() body: any, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'POST',
                path: '/api/v1/flashcard-study/session',
                body,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Post('session/:sessionId')
    @ApiOperation({ summary: 'Update study session' })
    async updateSession(
        @Param('sessionId') sessionId: string,
        @Body() body: any,
        @Req() req: Request
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'PUT',
                path: `/api/v1/flashcard-study/session/${sessionId}`,
                body,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Post('session/:sessionId/complete')
    @ApiOperation({ summary: 'Complete study session' })
    async completeSession(
        @Param('sessionId') sessionId: string,
        @Body() body: any,
        @Req() req: Request
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'POST',
                path: `/api/v1/flashcard-study/session/${sessionId}/complete`,
                body,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Post('session/:sessionId/review')
    @ApiOperation({ summary: 'Review card' })
    async reviewCard(
        @Param('sessionId') sessionId: string,
        @Body() body: any,
        @Req() req: Request
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'POST',
                path: `/api/v1/flashcard-study/session/${sessionId}/review`,
                body,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get('cards/:flashCardSetId')
    @ApiOperation({ summary: 'Get cards for study' })
    async getCards(
        @Param('flashCardSetId') flashCardSetId: string,
        @Req() req: Request,
        @Query() query: any
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: `/api/v1/flashcard-study/cards/${flashCardSetId}`,
                query,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get('history/:flashCardSetId')
    @ApiOperation({ summary: 'Get study history' })
    async getHistory(
        @Param('flashCardSetId') flashCardSetId: string,
        @Req() req: Request
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: `/api/v1/flashcard-study/history/${flashCardSetId}`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get('progress/:flashCardSetId')
    @ApiOperation({ summary: 'Get progress' })
    async getProgress(
        @Param('flashCardSetId') flashCardSetId: string,
        @Req() req: Request
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: `/api/v1/flashcard-study/progress/${flashCardSetId}`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    private h(req: Request) {
        return { 'user-agent': req.headers['user-agent'] || '' };
    }
    private t(req: Request) {
        const a = req.headers.authorization;
        return a?.startsWith('Bearer ')
            ? a.substring(7)
            : req.cookies?.token || req.cookies?.accessToken || '';
    }
}

// ==================== QUIZ PRACTICE ====================

@ApiTags('Quiz Practice')
@Controller('quiz-practice-attempts')
@ApiBearerAuth('access-token')
export class QuizPracticeProxyController {
    constructor(private readonly proxyService: ProxyService) {}

    @Post()
    @ApiOperation({ summary: 'Get or create practice attempt' })
    async getOrCreate(@Body() body: any, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'POST',
                path: '/api/v1/quiz-practice-attempts',
                body,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get('by-quizset/:quizSetId')
    @ApiOperation({ summary: 'Get attempt by quiz set' })
    async getByQuizSet(
        @Param('quizSetId') quizSetId: string,
        @Req() req: Request,
        @Query() query: any
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: `/api/v1/quiz-practice-attempts/by-quizset/${quizSetId}`,
                query,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get('stats/completion-rate')
    @ApiOperation({ summary: 'Get completion rate' })
    async getCompletionRate(@Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: '/api/v1/quiz-practice-attempts/stats/completion-rate',
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get(':attemptId')
    @ApiOperation({ summary: 'Get attempt by ID' })
    async getById(@Param('attemptId') attemptId: string, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: `/api/v1/quiz-practice-attempts/${attemptId}`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Put(':attemptId')
    @ApiOperation({ summary: 'Update attempt' })
    async update(
        @Param('attemptId') attemptId: string,
        @Body() body: any,
        @Req() req: Request
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'PUT',
                path: `/api/v1/quiz-practice-attempts/${attemptId}`,
                body,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Post(':attemptId/submit')
    @ApiOperation({ summary: 'Submit attempt' })
    async submit(@Param('attemptId') attemptId: string, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'POST',
                path: `/api/v1/quiz-practice-attempts/${attemptId}/submit`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Post(':attemptId/reset')
    @ApiOperation({ summary: 'Reset attempt' })
    async reset(
        @Param('attemptId') attemptId: string,
        @Body() body: any,
        @Req() req: Request
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'POST',
                path: `/api/v1/quiz-practice-attempts/${attemptId}/reset`,
                body,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    private h(req: Request) {
        return { 'user-agent': req.headers['user-agent'] || '' };
    }
    private t(req: Request) {
        const a = req.headers.authorization;
        return a?.startsWith('Bearer ')
            ? a.substring(7)
            : req.cookies?.token || req.cookies?.accessToken || '';
    }
}

// ==================== CHEATING LOG ====================

@ApiTags('Cheating Logs')
@Controller('cheatinglogs')
@ApiBearerAuth('access-token')
export class CheatingLogProxyController {
    constructor(private readonly proxyService: ProxyService) {}

    @Post()
    @ApiOperation({ summary: 'Log violation' })
    async logViolation(@Body() body: any, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'POST',
                path: '/api/v1/cheatinglogs',
                body,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get('attempt/:attemptId')
    @ApiOperation({ summary: 'Get logs for attempt (host)' })
    async getByAttempt(
        @Param('attemptId') attemptId: string,
        @Req() req: Request
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: `/api/v1/cheatinglogs/attempt/${attemptId}`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get('session/:sessionId/stats')
    @ApiOperation({ summary: 'Get session stats (host)' })
    async getSessionStats(
        @Param('sessionId') sessionId: string,
        @Req() req: Request
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: `/api/v1/cheatinglogs/session/${sessionId}/stats`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get('session/:sessionId/user/:userId')
    @ApiOperation({ summary: 'Get user attempts with logs (host)' })
    async getUserAttempts(
        @Param('sessionId') sessionId: string,
        @Param('userId') userId: string,
        @Req() req: Request
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: `/api/v1/cheatinglogs/session/${sessionId}/user/${userId}`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    private h(req: Request) {
        return { 'user-agent': req.headers['user-agent'] || '' };
    }
    private t(req: Request) {
        const a = req.headers.authorization;
        return a?.startsWith('Bearer ')
            ? a.substring(7)
            : req.cookies?.token || req.cookies?.accessToken || '';
    }
}
