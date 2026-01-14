import {
    Controller,
    Get,
    Post,
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
} from './dto/ai.dto';

@ApiTags('AI')
@Controller('ai')
export class AIController {
    private readonly logger = new Logger(AIController.name);

    constructor(private readonly aiService: AIService) {}

    @Post('quick-upload')
    @UseGuards(AuthGuard, RolesGuard)
    @Roles('teacher')
    @UseInterceptors(FileInterceptor('file'))
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({
        summary: 'Quick upload file cho AI Teacher (Teacher only)',
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
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Lấy danh sách file đã upload' })
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

    @Get('upload/:uploadId')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Lấy chi tiết file đã upload' })
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
    @Roles('teacher')
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Xóa file upload (Teacher only)' })
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
    @Roles('teacher')
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Tạo upload mới và trigger OCR (Teacher only)' })
    @ApiResponse({ status: 201, description: 'Upload đã được tạo' })
    async createUpload(
        @Req() req: AuthenticatedRequest,
        @Body() dto: UploadFileDto
    ) {
        return this.aiService.createUpload(req.user, dto);
    }

    @Post('upload-image')
    @UseGuards(AuthGuard, RolesGuard)
    @Roles('teacher')
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Upload image cho AI chat (Teacher only)' })
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
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Lấy trạng thái job' })
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
    @Roles('teacher')
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Hủy job đang xử lý (Teacher only)' })
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
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({
        summary: 'Lấy lịch sử quiz và flashcard đã tạo cho một file',
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
