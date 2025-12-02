import {
    Controller,
    Post,
    Body,
    UseInterceptors,
    UploadedFile,
    UseGuards,
    Req,
    Get,
    Query,
    Param,
    Delete,
} from '@nestjs/common';
import { AIService } from './ai.service';
import {
    ApiTags,
    ApiResponse,
    ApiOperation,
    ApiExtraModels,
    ApiCookieAuth,
    ApiQuery,
} from '@nestjs/swagger';
import { GenerateDto } from './dto/generate.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiFile } from 'src/common/decorators/file-upload.decorator';
import { AuthGuard } from 'src/common/guard/auth.guard';
import { AuthenticatedRequest } from '../auth/dto/request-with-auth.dto';

@ApiTags('AI')
@ApiExtraModels()
@Controller('ai')
export class AIController {
    constructor(private aiService: AIService) {}

    @Get('recent-uploads')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Get recent file uploads with generated history' })
    @ApiQuery({ name: 'limit', required: false, type: Number })
    @ApiResponse({
        status: 200,
        description: 'List of recent uploads retrieved successfully',
    })
    async getRecentUploads(
        @Req() req: AuthenticatedRequest,
        @Query('limit') limit?: string
    ) {
        const parsedLimit = limit ? parseInt(limit, 10) : 10;
        return this.aiService.getRecentUploads(req.user.id, parsedLimit);
    }

    @Get('upload/:id')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Get upload detail with all generated content' })
    @ApiResponse({
        status: 200,
        description: 'Upload detail retrieved successfully',
    })
    async getUploadDetail(
        @Req() req: AuthenticatedRequest,
        @Param('id') id: string
    ) {
        return this.aiService.getUploadDetail(id, req.user.id);
    }

    @Delete('upload/:id')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Delete an upload and its associated files' })
    @ApiResponse({
        status: 200,
        description: 'Upload deleted successfully',
    })
    async deleteUpload(
        @Req() req: AuthenticatedRequest,
        @Param('id') id: string
    ) {
        return this.aiService.deleteUpload(id, req.user.id);
    }

    @Post('regenerate/:id')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Regenerate quiz/flashcard from existing upload' })
    @ApiResponse({
        status: 200,
        description: 'Content regenerated successfully',
    })
    async regenerateFromUpload(
        @Req() req: AuthenticatedRequest,
        @Param('id') id: string,
        @Body()
        {
            quantityFlashcard,
            quantityQuizz,
            typeResult,
            isNarrowSearch,
            keyword,
        }: {
            quantityFlashcard?: number;
            quantityQuizz?: number;
            typeResult: number;
            isNarrowSearch?: boolean;
            keyword?: string;
        }
    ) {
        return this.aiService.regenerateFromUpload(
            id,
            req.user,
            typeResult,
            quantityFlashcard,
            quantityQuizz,
            isNarrowSearch,
            keyword
        );
    }

    @Post('generate')
    @ApiOperation({ summary: 'Generate content based on a prompt' })
    @ApiResponse({
        status: 200,
        description: 'Content generated successfully',
        type: String,
    })
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    async generate(@Body() generateDto: GenerateDto) {
        return this.aiService.generateContent(generateDto.prompt);
    }

    @Post('generate-from-file')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @UseInterceptors(FileInterceptor('file'))
    @ApiOperation({
        summary:
            'Extract and embed text from an uploaded file (async job queue)',
    })
    @ApiResponse({
        status: 200,
        description: 'Job created successfully, returns job_id',
        type: String,
    })
    @ApiFile('file')
    async filePrompt(
        @UploadedFile() file: Express.Multer.File,
        @Req() req: AuthenticatedRequest,
        @Body()
        {
            quantityFlashcard,
            quantityQuizz,
            typeResult,
            isNarrowSearch,
            keyword,
        }: {
            quantityFlashcard?: number;
            quantityQuizz?: number;
            typeResult: number;
            isNarrowSearch?: boolean;
            keyword?: string;
        }
    ) {
        const jobId = this.aiService.createJob(
            file,
            req.user,
            typeResult,
            quantityFlashcard,
            quantityQuizz,
            isNarrowSearch,
            keyword
        );
        return {
            jobId,
            status: 'pending',
            message:
                'Job created successfully. Use the job ID to poll for status.',
        };
    }

    @Get('job/:jobId')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Get status and result of a job' })
    @ApiResponse({
        status: 200,
        description: 'Job status retrieved successfully',
    })
    async getJobStatus(
        @Req() req: AuthenticatedRequest,
        @Param('jobId') jobId: string
    ) {
        return this.aiService.getJobStatus(jobId);
    }

    @Delete('job/:jobId')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Cancel a running job' })
    @ApiResponse({
        status: 200,
        description: 'Job canceled successfully',
    })
    async cancelJob(
        @Req() req: AuthenticatedRequest,
        @Param('jobId') jobId: string
    ) {
        return this.aiService.cancelJob(jobId, req.user.id);
    }
}
