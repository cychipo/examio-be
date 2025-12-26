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
} from '@nestjs/common';
import {
    ApiTags,
    ApiOperation,
    ApiResponse,
    ApiCookieAuth,
    ApiParam,
    ApiQuery,
} from '@nestjs/swagger';
import { AuthGuard, AuthenticatedRequest } from '@examio/common';
import { AIService } from './ai.service';
import { UploadFileDto, RegenerateDto, UploadImageDto } from './dto/ai.dto';

@ApiTags('AI')
@Controller('ai')
export class AIController {
    constructor(private readonly aiService: AIService) {}

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
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Xóa file upload' })
    @ApiParam({ name: 'uploadId', description: 'ID của upload' })
    @ApiResponse({ status: 200, description: 'Xóa thành công' })
    async deleteUpload(
        @Req() req: AuthenticatedRequest,
        @Param('uploadId') uploadId: string
    ) {
        return this.aiService.deleteUpload(uploadId, req.user);
    }

    @Post('upload')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Tạo upload mới và trigger OCR' })
    @ApiResponse({ status: 201, description: 'Upload đã được tạo' })
    async createUpload(
        @Req() req: AuthenticatedRequest,
        @Body() dto: UploadFileDto
    ) {
        return this.aiService.createUpload(req.user, dto);
    }

    @Post('upload-image')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Upload image cho AI chat' })
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
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Tạo lại quiz/flashcard từ file' })
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
        return this.aiService.getJobStatus(jobId, req.user);
    }
}
