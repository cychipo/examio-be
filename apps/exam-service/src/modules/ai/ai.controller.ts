import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Body,
    Param,
    Query,
    UseGuards,
    Req,
    UseInterceptors,
    UploadedFile,
    Logger,
    BadRequestException,
} from '@nestjs/common';
import {
    ApiTags,
    ApiOperation,
    ApiResponse,
    ApiCookieAuth,
    ApiParam,
    ApiQuery,
    ApiConsumes,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard, AuthenticatedRequest, Roles, RolesGuard } from '@examio/common';
import { AIService } from './ai.service';
import {
    UploadFileDto,
    RegenerateDto,
    UploadImageDto,
    GenerateFromFileDto,
    TutorIngestDto,
    TutorKnowledgeFolderDto,
    TutorKnowledgeUploadDto,
    TutorQueryDto,
} from './dto/ai.dto';

@ApiTags('AI')
@Controller('ai')
export class AIController {
    private readonly logger = new Logger(AIController.name);

    constructor(private readonly aiService: AIService) {}

    @Post('quick-upload')
    @UseGuards(AuthGuard, RolesGuard)
    @Roles('teacher', 'student')
    @UseInterceptors(FileInterceptor('file'))
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({
        summary: 'Quick upload file cho AI Teacher (Teacher & Student)',
    })
    @ApiConsumes('multipart/form-data')
    @ApiResponse({ status: 201, description: 'File đã được upload' })
    async quickUpload(
        @Req() req: AuthenticatedRequest,
        @UploadedFile() file: Express.Multer.File
    ) {
        this.logger.log('--- EXAM SERVICE: QUICK UPLOAD REQUEST RECEIVED ---');
        this.logger.log(`User: ${req.user?.id}`);
        this.logger.log(
            `File: ${file ? `${file.originalname} (${file.size} bytes)` : 'MISSING'}`
        );

        if (!file || !file.buffer) {
            this.logger.error('No file received in exam-service quick-upload');
            throw new BadRequestException('No file uploaded');
        }

        try {
            return await this.aiService.quickUpload(req.user, file);
        } catch (error) {
            this.logger.error(
                `--- EXAM SERVICE: QUICK UPLOAD ERROR --- ${error.message}`,
                error.stack
            );
            throw error;
        }
    }

    @Post('generate-from-file')
    @UseGuards(AuthGuard, RolesGuard)
    @Roles('teacher')
    @UseInterceptors(FileInterceptor('file'))
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({
        summary: 'Upload file và tạo quiz/flashcard (Teacher only)',
    })
    @ApiConsumes('multipart/form-data')
    @ApiResponse({ status: 201, description: 'Job đã được tạo' })
    async generateFromFile(
        @Req() req: AuthenticatedRequest,
        @UploadedFile() file: Express.Multer.File,
        @Body() dto: GenerateFromFileDto
    ) {
        console.log(
            '--- EXAM SERVICE: GENERATE FROM FILE REQUEST RECEIVED ---'
        );
        console.log('User:', req.user?.id);
        console.log(
            'File:',
            file ? `${file.originalname} (${file.size} bytes)` : 'MISSING'
        );

        try {
            return await this.aiService.generateFromFile(req.user, file, dto);
        } catch (error) {
            console.error('--- EXAM SERVICE: GENERATE ERROR ---', error);
            this.logger.error(`Generate error: ${error.message}`, error.stack);
            throw error;
        }
    }

    @Get('recent-uploads')
    @UseGuards(AuthGuard, RolesGuard)
    @Roles('teacher')
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Lấy danh sách file đã upload (Teacher & Student)' })
    @ApiQuery({ name: 'page', required: false, type: Number })
    @ApiQuery({ name: 'size', required: false, type: Number })
    @ApiResponse({ status: 200, description: 'Danh sách uploads' })
    async getRecentUploads(
        @Req() req: AuthenticatedRequest,
        @Query('page') page?: number,
        @Query('size') size?: number
    ) {
        return this.aiService.getRecentUploads(
            req.user,
            page ? Number(page) : 1,
            size ? Number(size) : 10
        );
    }

    @Get('models')
    @UseGuards(AuthGuard, RolesGuard)
    @Roles('teacher', 'student')
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Lay catalog model AI cho frontend' })
    @ApiResponse({ status: 200, description: 'Danh sach model AI' })
    async getModels() {
        return this.aiService.getModelCatalog();
    }

    @Post('tutor/ingest')
    @UseGuards(AuthGuard, RolesGuard)
    @Roles('teacher')
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Tạo tutor ingest job (Teacher only)' })
    async tutorIngest(
        @Req() req: AuthenticatedRequest,
        @Body() dto: TutorIngestDto
    ) {
        return this.aiService.tutorIngest(req.user, dto);
    }

    @Post('tutor/knowledge-files')
    @UseGuards(AuthGuard, RolesGuard)
    @Roles('teacher')
    @UseInterceptors(FileInterceptor('file'))
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Upload file tri thức cho GenAI Tutor (Teacher only)' })
    @ApiConsumes('multipart/form-data')
    async uploadTutorKnowledgeFile(
        @Req() req: AuthenticatedRequest,
        @UploadedFile() file: Express.Multer.File,
        @Body() dto: TutorKnowledgeUploadDto
    ) {
        return this.aiService.uploadTutorKnowledgeFile(req.user, file, dto);
    }

    @Post('tutor/knowledge-folders')
    @UseGuards(AuthGuard, RolesGuard)
    @Roles('teacher')
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Tạo folder tri thức tutor' })
    async createTutorKnowledgeFolder(
        @Req() req: AuthenticatedRequest,
        @Body() dto: TutorKnowledgeFolderDto
    ) {
        return this.aiService.createTutorKnowledgeFolder(req.user, dto);
    }

    @Put('tutor/knowledge-folders/:folderId')
    @UseGuards(AuthGuard, RolesGuard)
    @Roles('teacher')
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Cập nhật folder tri thức tutor' })
    async updateTutorKnowledgeFolder(
        @Req() req: AuthenticatedRequest,
        @Param('folderId') folderId: string,
        @Body() dto: TutorKnowledgeFolderDto
    ) {
        return this.aiService.updateTutorKnowledgeFolder(req.user, folderId, dto);
    }

    @Delete('tutor/knowledge-folders/:folderId')
    @UseGuards(AuthGuard, RolesGuard)
    @Roles('teacher')
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Xóa folder tri thức tutor' })
    async deleteTutorKnowledgeFolder(@Param('folderId') folderId: string) {
        return this.aiService.deleteTutorKnowledgeFolder(folderId);
    }

    @Get('tutor/knowledge-folders/:folderId/contents')
    @UseGuards(AuthGuard, RolesGuard)
    @Roles('teacher')
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Lấy nội dung folder tri thức tutor' })
    async getTutorKnowledgeFolderContents(
        @Req() req: AuthenticatedRequest,
        @Param('folderId') folderId: string,
        @Query('page') page?: string,
        @Query('pageSize') pageSize?: string
    ) {
        return this.aiService.getTutorKnowledgeFolderContents(
            req.user,
            folderId,
            page ? Number(page) : 1,
            pageSize ? Number(pageSize) : 12
        );
    }

    @Get('tutor/knowledge-folders')
    @UseGuards(AuthGuard, RolesGuard)
    @Roles('teacher')
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Lấy danh sách folder tri thức tutor' })
    async listTutorKnowledgeFolders(@Req() req: AuthenticatedRequest) {
        return this.aiService.listTutorKnowledgeFolders(req.user);
    }

    @Get('tutor/knowledge-stats')
    @UseGuards(AuthGuard, RolesGuard)
    @Roles('teacher')
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Lấy thống kê kho tri thức tutor' })
    async getTutorKnowledgeStats(
        @Req() req: AuthenticatedRequest,
        @Query('folderId') folderId?: string,
    ) {
        return this.aiService.getTutorKnowledgeStats(req.user, folderId);
    }

    @Get('tutor/knowledge-files')
    @UseGuards(AuthGuard, RolesGuard)
    @Roles('teacher')
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Lấy danh sách file tri thức tutor' })
    async listTutorKnowledgeFiles(@Req() req: AuthenticatedRequest) {
        return this.aiService.listTutorKnowledgeFiles(req.user);
    }

    @Get('tutor/knowledge-files/search')
    @UseGuards(AuthGuard, RolesGuard)
    @Roles('teacher')
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Filter/search/sort danh sách file tri thức tutor' })
    async searchTutorKnowledgeFiles(
        @Req() req: AuthenticatedRequest,
        @Query('folderId') folderId?: string,
        @Query('status') status?: string,
        @Query('search') search?: string,
        @Query('sortBy') sortBy?: string,
        @Query('sortOrder') sortOrder?: string,
        @Query('page') page?: string,
        @Query('pageSize') pageSize?: string
    ) {
        return this.aiService.searchTutorKnowledgeFiles(req.user, {
            folderId,
            status,
            search,
            sortBy,
            sortOrder,
            page: page ? Number(page) : 1,
            pageSize: pageSize ? Number(pageSize) : 12,
        });
    }

    @Post('tutor/knowledge-files/:fileId/reprocess')
    @UseGuards(AuthGuard, RolesGuard)
    @Roles('teacher')
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Retry/reprocess file tri thức tutor' })
    async reprocessTutorKnowledgeFile(@Param('fileId') fileId: string) {
        return this.aiService.reprocessTutorKnowledgeFile(fileId);
    }

    @Post('tutor/knowledge-files/bulk-delete')
    @UseGuards(AuthGuard, RolesGuard)
    @Roles('teacher')
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Bulk delete file tri thức tutor' })
    async bulkDeleteTutorKnowledgeFiles(@Body('fileIds') fileIds: string[]) {
        return this.aiService.bulkDeleteTutorKnowledgeFiles(fileIds);
    }

    @Post('tutor/knowledge-files/bulk-reprocess')
    @UseGuards(AuthGuard, RolesGuard)
    @Roles('teacher')
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Bulk reprocess file tri thức tutor' })
    async bulkReprocessTutorKnowledgeFiles(@Body('fileIds') fileIds: string[]) {
        return this.aiService.bulkReprocessTutorKnowledgeFiles(fileIds);
    }

    @Get('tutor/ingest')
    @UseGuards(AuthGuard, RolesGuard)
    @Roles('teacher', 'student')
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Lấy danh sách tutor ingest jobs' })
    async listTutorIngestJobs() {
        return this.aiService.listTutorIngestJobs();
    }

    @Get('tutor/ingest/:jobId')
    @UseGuards(AuthGuard, RolesGuard)
    @Roles('teacher', 'student')
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Lấy chi tiết tutor ingest job' })
    async getTutorIngestJob(@Param('jobId') jobId: string) {
        return this.aiService.getTutorIngestJob(jobId);
    }

    @Post('tutor/query')
    @UseGuards(AuthGuard, RolesGuard)
    @Roles('teacher', 'student')
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Hỏi tutor' })
    async tutorQuery(@Body() dto: TutorQueryDto) {
        return this.aiService.tutorQuery(dto);
    }

    @Post('tutor/stream')
    @UseGuards(AuthGuard, RolesGuard)
    @Roles('teacher', 'student')
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Hỏi tutor với streaming' })
    async tutorStream(@Body() dto: TutorQueryDto) {
        return this.aiService.tutorStream(dto);
    }

    @Get('tutor/graph/job/:jobId')
    @UseGuards(AuthGuard, RolesGuard)
    @Roles('teacher')
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Xem graph tutor theo job' })
    async getTutorGraphByJob(@Param('jobId') jobId: string) {
        return this.aiService.getTutorGraphByJob(jobId);
    }

    @Get('tutor/graph/document/:documentId')
    @UseGuards(AuthGuard, RolesGuard)
    @Roles('teacher')
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Xem graph tutor theo document' })
    async getTutorGraphByDocument(@Param('documentId') documentId: string) {
        return this.aiService.getTutorGraphByDocument(documentId);
    }

    @Get('upload/:uploadId')
    @UseGuards(AuthGuard, RolesGuard)
    @Roles('teacher', 'student')
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Lấy chi tiết file đã upload (Teacher & Student)' })
    @ApiParam({ name: 'uploadId', description: 'ID của upload' })
    @ApiResponse({ status: 200, description: 'Chi tiết upload' })
    async getUploadDetail(
        @Req() req: AuthenticatedRequest,
        @Param('uploadId') uploadId: string
    ) {
        return this.aiService.getUploadDetail(uploadId, req.user);
    }

    @Delete('upload/:uploadId')
    @UseGuards(AuthGuard, RolesGuard)
    @Roles('teacher', 'student')
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Xóa file upload (Teacher & Student)' })
    @ApiParam({ name: 'uploadId', description: 'ID của upload' })
    @ApiResponse({ status: 200, description: 'Xóa thành công' })
    async deleteUpload(
        @Req() req: AuthenticatedRequest,
        @Param('uploadId') uploadId: string
    ) {
        return this.aiService.deleteUpload(uploadId, req.user);
    }

    @Post('upload')
    @UseGuards(AuthGuard, RolesGuard)
    @Roles('teacher', 'student')
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Tạo upload mới và trigger OCR (Teacher & Student)' })
    @ApiResponse({ status: 201, description: 'Upload đã được tạo' })
    async createUpload(
        @Req() req: AuthenticatedRequest,
        @Body() dto: UploadFileDto
    ) {
        return this.aiService.createUpload(req.user, dto);
    }

    @Post('upload-image')
    @UseGuards(AuthGuard, RolesGuard)
    @Roles('teacher', 'student')
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Upload image cho AI chat (Teacher & Student)' })
    @ApiResponse({ status: 201, description: 'Image đã được upload' })
    async uploadImage(
        @Req() req: AuthenticatedRequest,
        @Body() dto: UploadImageDto
    ) {
        // For now, return a placeholder - actual implementation would handle base64/URL
        return {
            success: true,
            message: 'Image upload endpoint - implementation pending',
        };
    }

    @Post('regenerate/:uploadId')
    @UseGuards(AuthGuard, RolesGuard)
    @Roles('teacher')
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Tạo lại quiz/flashcard từ file (Teacher only)' })
    @ApiParam({ name: 'uploadId', description: 'ID của upload' })
    @ApiResponse({ status: 200, description: 'Regenerate request' })
    async regenerate(
        @Req() req: AuthenticatedRequest,
        @Param('uploadId') uploadId: string,
        @Body() dto: RegenerateDto
    ) {
        return this.aiService.regenerate(uploadId, req.user, dto);
    }

    @Get('job/:jobId')
    @UseGuards(AuthGuard, RolesGuard)
    @Roles('teacher', 'student')
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Lấy trạng thái job (Teacher & Student)' })
    @ApiParam({ name: 'jobId', description: 'ID của job (userStorageId)' })
    @ApiResponse({ status: 200, description: 'Trạng thái job' })
    async getJobStatus(
        @Req() req: AuthenticatedRequest,
        @Param('jobId') jobId: string
    ) {
        // Validate jobId
        if (!jobId || jobId === 'undefined' || jobId === 'null') {
            return {
                error: 'Invalid job ID',
                message: 'Job ID không hợp lệ',
                statusCode: 400,
            };
        }
        return this.aiService.getJobStatus(jobId, req.user);
    }

    @Delete('job/:jobId')
    @UseGuards(AuthGuard, RolesGuard)
    @Roles('teacher', 'student')
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Hủy job đang xử lý (Teacher & Student)' })
    @ApiParam({ name: 'jobId', description: 'ID của job (userStorageId)' })
    @ApiResponse({ status: 200, description: 'Job đã được hủy' })
    async cancelJob(
        @Req() req: AuthenticatedRequest,
        @Param('jobId') jobId: string
    ) {
        // Validate jobId
        if (!jobId || jobId === 'undefined' || jobId === 'null') {
            return {
                error: 'Invalid job ID',
                message: 'Job ID không hợp lệ',
                statusCode: 400,
            };
        }
        return this.aiService.cancelJob(jobId, req.user);
    }

    @Get('upload/:uploadId/history')
    @UseGuards(AuthGuard, RolesGuard)
    @Roles('teacher', 'student')
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({
        summary: 'Lấy lịch sử quiz và flashcard đã tạo cho một file (Teacher & Student)',
    })
    @ApiParam({ name: 'uploadId', description: 'ID của UserStorage' })
    @ApiResponse({ status: 200, description: 'Lịch sử quiz và flashcard' })
    async getUploadHistory(
        @Req() req: AuthenticatedRequest,
        @Param('uploadId') uploadId: string
    ) {
        return this.aiService.getUploadHistory(uploadId, req.user);
    }
}
