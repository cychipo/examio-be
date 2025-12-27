import {
    Controller,
    Get,
    Post,
    Patch,
    Delete,
    Param,
    Body,
    Req,
    UseGuards,
    Res,
    Header,
} from '@nestjs/common';
import { Response } from 'express';
import {
    ApiTags,
    ApiOperation,
    ApiResponse,
    ApiCookieAuth,
} from '@nestjs/swagger';
import { AuthGuard, AuthenticatedRequest } from '@examio/common';
import { AIChatService } from './ai-chat.service';
import { Observable } from 'rxjs';

@ApiTags('AI Chat')
@Controller('ai-chat')
@UseGuards(AuthGuard)
@ApiCookieAuth('cookie-auth')
export class AIChatController {
    constructor(private readonly chatService: AIChatService) {}

    // ==================== CHAT ====================

    @Get()
    @ApiOperation({ summary: 'Lấy danh sách chats' })
    @ApiResponse({ status: 200, description: 'Danh sách chats' })
    async getChats(@Req() req: AuthenticatedRequest) {
        return this.chatService.getChats(req.user);
    }

    @Post()
    @ApiOperation({ summary: 'Tạo chat mới' })
    @ApiResponse({ status: 201, description: 'Chat đã tạo' })
    async createChat(
        @Req() req: AuthenticatedRequest,
        @Body() body: { title?: string }
    ) {
        return this.chatService.createChat(req.user, body?.title);
    }

    @Patch(':chatId')
    @ApiOperation({ summary: 'Cập nhật chat' })
    async updateChat(
        @Req() req: AuthenticatedRequest,
        @Param('chatId') chatId: string,
        @Body() body: { title: string }
    ) {
        return this.chatService.updateChat(chatId, req.user, body.title);
    }

    @Delete(':chatId')
    @ApiOperation({ summary: 'Xóa chat' })
    async deleteChat(
        @Req() req: AuthenticatedRequest,
        @Param('chatId') chatId: string
    ) {
        return this.chatService.deleteChat(chatId, req.user);
    }

    @Get(':chatId/exists')
    @ApiOperation({ summary: 'Kiểm tra chat tồn tại' })
    async chatExists(@Param('chatId') chatId: string) {
        return this.chatService.chatExists(chatId);
    }

    // ==================== MESSAGES ====================

    @Get(':chatId/messages')
    @ApiOperation({ summary: 'Lấy messages của chat' })
    async getChatMessages(
        @Req() req: AuthenticatedRequest,
        @Param('chatId') chatId: string
    ) {
        return this.chatService.getMessages(chatId, req.user);
    }

    @Post(':chatId/message')
    @ApiOperation({ summary: 'Gửi message đến chat' })
    async sendMessage(
        @Req() req: AuthenticatedRequest,
        @Param('chatId') chatId: string,
        @Body()
        body: {
            message: string;
            imageUrl?: string;
            documentId?: string;
            documentIds?: string[];
            documentName?: string;
        }
    ) {
        return this.chatService.sendMessage(chatId, req.user, body);
    }

    @Post(':chatId/stream')
    @ApiOperation({ summary: 'Gửi message với streaming response (SSE)' })
    async streamMessage(
        @Req() req: AuthenticatedRequest,
        @Res() res: Response,
        @Param('chatId') chatId: string,
        @Body()
        body: {
            message: string;
            imageUrl?: string;
            documentId?: string;
            documentIds?: string[];
            documentName?: string;
        }
    ) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const observable = await this.chatService.streamMessage(
            chatId,
            req.user,
            body
        );

        const subscription = observable.subscribe({
            next: (event) => {
                res.write(`data: ${JSON.stringify(event)}\n\n`);
            },
            error: (err) => {
                res.write(
                    `data: ${JSON.stringify({ type: 'error', data: err.message })}\n\n`
                );
                res.end();
            },
            complete: () => {
                res.end();
            },
        });

        req.on('close', () => {
            subscription.unsubscribe();
        });
    }

    @Patch('message/:messageId')
    @ApiOperation({ summary: 'Cập nhật message' })
    async updateMessage(
        @Req() req: AuthenticatedRequest,
        @Param('messageId') messageId: string,
        @Body() body: { content: string }
    ) {
        return this.chatService.updateMessage(
            messageId,
            req.user,
            body.content
        );
    }

    @Delete('message/:messageId')
    @ApiOperation({ summary: 'Xóa message' })
    async deleteMessage(
        @Req() req: AuthenticatedRequest,
        @Param('messageId') messageId: string
    ) {
        return this.chatService.deleteMessage(messageId, req.user);
    }

    @Post('message/:messageId/regenerate')
    @ApiOperation({ summary: 'Regenerate AI response từ message' })
    async regenerateFromMessage(
        @Req() req: AuthenticatedRequest,
        @Param('messageId') messageId: string
    ) {
        return this.chatService.regenerateFromMessage(messageId, req.user);
    }

    // ==================== DOCUMENTS ====================

    @Get(':chatId/documents')
    @ApiOperation({ summary: 'Lấy documents của chat' })
    async getDocuments(
        @Req() req: AuthenticatedRequest,
        @Param('chatId') chatId: string
    ) {
        return this.chatService.getDocuments(chatId, req.user);
    }

    @Post(':chatId/documents')
    @ApiOperation({ summary: 'Thêm document vào chat' })
    async addDocument(
        @Req() req: AuthenticatedRequest,
        @Param('chatId') chatId: string,
        @Body() body: { documentId: string; documentName: string }
    ) {
        return this.chatService.addDocument(
            chatId,
            req.user,
            body.documentId,
            body.documentName
        );
    }

    @Delete(':chatId/documents/:documentId')
    @ApiOperation({ summary: 'Xóa document khỏi chat' })
    async removeDocument(
        @Req() req: AuthenticatedRequest,
        @Param('chatId') chatId: string,
        @Param('documentId') documentId: string
    ) {
        return this.chatService.removeDocument(chatId, req.user, documentId);
    }
}
