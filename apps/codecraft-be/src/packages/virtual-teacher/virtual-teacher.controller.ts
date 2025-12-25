import {
    Controller,
    Post,
    Body,
    UseGuards,
    Req,
    UseInterceptors,
    UploadedFile,
    BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
    ApiTags,
    ApiOperation,
    ApiResponse,
    ApiCookieAuth,
} from '@nestjs/swagger';
import { VirtualTeacherService } from './virtual-teacher.service';
import { ChatRequestDto, VTChatResponseDto } from './dto/chat.dto';
import { AuthGuard } from 'src/common/guard/auth.guard';
import { AuthenticatedRequest } from '../auth/dto/request-with-auth.dto';
import { AIService } from '../ai/ai.service';

@ApiTags('Virtual Teacher')
@Controller('virtual-teacher')
export class VirtualTeacherController {
    constructor(
        private readonly virtualTeacherService: VirtualTeacherService,
        private readonly aiService: AIService
    ) {}

    @Post('upload')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @UseInterceptors(FileInterceptor('file'))
    @ApiOperation({
        summary: 'Upload file for AI Virtual Teacher knowledge base',
        description:
            'Upload a PDF file to be processed (OCR, Vectorize) and added to the knowledge base.',
    })
    async uploadFile(
        @Req() req: AuthenticatedRequest,
        @UploadedFile() file: Express.Multer.File
    ) {
        const jobId = await this.virtualTeacherService.uploadFileForTraining(
            file,
            req.user
        );
        return { success: true, jobId };
    }

    /**
     * Quick upload endpoint - uploads file to R2 and creates UserStorage record
     * but does NOT process OCR/vectorization. This allows immediate chatting.
     * OCR/vectorization will be done on-demand when first message is sent.
     */
    @Post('quick-upload')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @UseInterceptors(FileInterceptor('file'))
    @ApiOperation({
        summary: 'Quick upload file for immediate chat',
        description:
            'Upload a PDF file quickly without waiting for OCR/vectorization. Processing happens on-demand.',
    })
    @ApiResponse({
        status: 200,
        description: 'File uploaded successfully',
    })
    async quickUploadFile(
        @Req() req: AuthenticatedRequest,
        @UploadedFile() file: Express.Multer.File
    ) {
        if (!file) {
            throw new BadRequestException('File is required');
        }

        const userStorage = await this.aiService.quickUploadFile(
            file,
            req.user
        );
        return {
            success: true,
            userStorageId: userStorage.id,
            filename: userStorage.filename,
            url: userStorage.url,
        };
    }

    @Post('chat')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({
        summary: 'Chat with AI Virtual Teacher',
        description:
            'Send a message to the AI teacher and receive a response. Optionally include a document ID for context.',
    })
    @ApiResponse({
        status: 200,
        description: 'Chat response from AI teacher',
        type: VTChatResponseDto,
    })
    @ApiResponse({
        status: 401,
        description: 'Unauthorized - Token required',
    })
    async chat(
        @Req() req: AuthenticatedRequest,
        @Body() dto: ChatRequestDto
    ): Promise<VTChatResponseDto> {
        return this.virtualTeacherService.processChat(dto, req.user.id);
    }
}
