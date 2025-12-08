import { Controller, Post, Body, UseGuards, Req, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
    ApiTags,
    ApiOperation,
    ApiResponse,
    ApiCookieAuth,
} from '@nestjs/swagger';
import { VirtualTeacherService } from './virtual-teacher.service';
import { ChatRequestDto, ChatResponseDto } from './dto/chat.dto';
import { AuthGuard } from 'src/common/guard/auth.guard';
import { AuthenticatedRequest } from '../auth/dto/request-with-auth.dto';

@ApiTags('Virtual Teacher')
@Controller('virtual-teacher')
export class VirtualTeacherController {
    constructor(
        private readonly virtualTeacherService: VirtualTeacherService,
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
        @UploadedFile() file: Express.Multer.File,
    ) {
        const jobId = await this.virtualTeacherService.uploadFileForTraining(
            file,
            req.user
        );
        return { success: true, jobId };
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
        type: ChatResponseDto,
    })
    @ApiResponse({
        status: 401,
        description: 'Unauthorized - Token required',
    })
    async chat(
        @Req() req: AuthenticatedRequest,
        @Body() dto: ChatRequestDto,
    ): Promise<ChatResponseDto> {
        return this.virtualTeacherService.processChat(dto, req.user.id);
    }
}
