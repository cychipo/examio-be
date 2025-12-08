import {
    Controller,
    Get,
    Post,
    Patch,
    Delete,
    Body,
    Param,
    UseGuards,
    Req,
    Res,
} from '@nestjs/common';
import { Response } from 'express';
import {
    ApiTags,
    ApiOperation,
    ApiResponse,
    ApiCookieAuth,
    ApiParam,
} from '@nestjs/swagger';
import { AIChatService } from './ai-chat.service';
import {
    CreateChatDto,
    SendMessageDto,
    UpdateChatDto,
    UpdateMessageDto,
    ChatResponseDto,
    ChatListResponseDto,
    MessageResponseDto,
    SendMessageResponseDto,
} from './dto/ai-chat.dto';
import { AuthGuard } from 'src/common/guard/auth.guard';
import { AuthenticatedRequest } from '../auth/dto/request-with-auth.dto';

@ApiTags('AI Chat')
@Controller('ai-chat')
export class AIChatController {
    constructor(private readonly aiChatService: AIChatService) {}

    @Get()
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Get all chats for current user' })
    @ApiResponse({ status: 200, type: ChatListResponseDto })
    async getChats(
        @Req() req: AuthenticatedRequest
    ): Promise<ChatListResponseDto> {
        return this.aiChatService.getChats(req.user.id);
    }

    @Get(':id/messages')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Get messages for a specific chat' })
    @ApiParam({ name: 'id', description: 'Chat ID' })
    @ApiResponse({ status: 200, type: [MessageResponseDto] })
    async getChatMessages(
        @Req() req: AuthenticatedRequest,
        @Param('id') chatId: string
    ): Promise<MessageResponseDto[]> {
        return this.aiChatService.getChatMessages(chatId, req.user.id);
    }

    @Post()
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Create a new chat' })
    @ApiResponse({ status: 201, type: ChatResponseDto })
    async createChat(
        @Req() req: AuthenticatedRequest,
        @Body() dto: CreateChatDto
    ): Promise<ChatResponseDto> {
        return this.aiChatService.createChat(req.user.id, dto);
    }

    @Post(':id/message')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Send a message to a chat and get AI response' })
    @ApiParam({ name: 'id', description: 'Chat ID' })
    @ApiResponse({ status: 200, type: SendMessageResponseDto })
    async sendMessage(
        @Req() req: AuthenticatedRequest,
        @Param('id') chatId: string,
        @Body() dto: SendMessageDto
    ): Promise<SendMessageResponseDto> {
        return this.aiChatService.sendMessage(chatId, req.user.id, dto);
    }

    @Patch(':id')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Update chat title' })
    @ApiParam({ name: 'id', description: 'Chat ID' })
    @ApiResponse({ status: 200, type: ChatResponseDto })
    async updateChat(
        @Req() req: AuthenticatedRequest,
        @Param('id') chatId: string,
        @Body() dto: UpdateChatDto
    ): Promise<ChatResponseDto> {
        return this.aiChatService.updateChat(chatId, req.user.id, dto);
    }

    @Delete(':id')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Delete a chat' })
    @ApiParam({ name: 'id', description: 'Chat ID' })
    @ApiResponse({ status: 200, description: 'Chat deleted successfully' })
    async deleteChat(
        @Req() req: AuthenticatedRequest,
        @Param('id') chatId: string
    ): Promise<{ success: boolean; message: string }> {
        await this.aiChatService.deleteChat(chatId, req.user.id);
        return { success: true, message: 'Chat deleted successfully' };
    }

    @Patch('message/:id')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Update a message' })
    @ApiParam({ name: 'id', description: 'Message ID' })
    @ApiResponse({ status: 200, type: MessageResponseDto })
    async updateMessage(
        @Req() req: AuthenticatedRequest,
        @Param('id') messageId: string,
        @Body() dto: UpdateMessageDto
    ): Promise<MessageResponseDto> {
        return this.aiChatService.updateMessage(messageId, req.user.id, dto);
    }

    @Delete('message/:id')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Delete a message' })
    @ApiParam({ name: 'id', description: 'Message ID' })
    @ApiResponse({ status: 200, description: 'Message deleted successfully' })
    async deleteMessage(
        @Req() req: AuthenticatedRequest,
        @Param('id') messageId: string
    ): Promise<{ success: boolean; message: string }> {
        await this.aiChatService.deleteMessage(messageId, req.user.id);
        return { success: true, message: 'Message deleted successfully' };
    }

    @Post('message/:id/regenerate')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({
        summary: 'Regenerate AI response from a message',
    })
    @ApiParam({ name: 'id', description: 'Message ID to regenerate from' })
    @ApiResponse({ status: 200, type: SendMessageResponseDto })
    async regenerateFromMessage(
        @Req() req: AuthenticatedRequest,
        @Param('id') messageId: string
    ): Promise<SendMessageResponseDto> {
        return this.aiChatService.regenerateFromMessage(messageId, req.user.id);
    }

    @Get(':id/exists')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Check if chat exists' })
    @ApiParam({ name: 'id', description: 'Chat ID' })
    @ApiResponse({
        status: 200,
        description: 'Returns whether chat exists',
    })
    async chatExists(
        @Req() req: AuthenticatedRequest,
        @Param('id') chatId: string
    ): Promise<{ exists: boolean }> {
        const exists = await this.aiChatService.chatExists(chatId, req.user.id);
        return { exists };
    }

    @Post(':id/stream')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Send message and stream AI response via SSE' })
    @ApiParam({ name: 'id', description: 'Chat ID' })
    async streamMessage(
        @Req() req: AuthenticatedRequest,
        @Param('id') chatId: string,
        @Body() dto: SendMessageDto,
        @Res() res: Response
    ): Promise<void> {
        const origin = (req.headers as any).origin || 'http://localhost:3001';
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.flushHeaders();

        try {
            const { userMessage, chatTitle, isNewChat } =
                await this.aiChatService.createUserMessageForStream(
                    chatId,
                    req.user.id,
                    dto
                );

            res.write(
                `data: ${JSON.stringify({ type: 'user_message', data: userMessage })}\n\n`
            );

            let assistantMessage: any = null;
            for await (const chunk of this.aiChatService.streamMessage(
                chatId,
                req.user.id,
                dto
            )) {
                if (typeof chunk === 'string') {
                    res.write(
                        `data: ${JSON.stringify({ type: 'chunk', data: chunk })}\n\n`
                    );
                } else {
                    // This is the MessageResponseDto yielded at the end
                    assistantMessage = chunk;
                }
            }

            res.write(
                `data: ${JSON.stringify({ type: 'done', data: { assistantMessage, isNewChat } })}\n\n`
            );
            res.end();
        } catch (error: any) {
            res.write(
                `data: ${JSON.stringify({ type: 'error', data: error.message || 'An error occurred' })}\n\n`
            );
            res.end();
        }
    }

    @Post('message/:id/regenerate-stream')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Regenerate and stream AI response' })
    @ApiParam({ name: 'id', description: 'Message ID to regenerate from' })
    async regenerateStream(
        @Req() req: AuthenticatedRequest,
        @Param('id') messageId: string,
        @Res() res: Response
    ): Promise<void> {
        const origin = (req.headers as any).origin || 'http://localhost:3001';
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.flushHeaders();

        try {
            const { chatId, userMessage } =
                await this.aiChatService.deleteMessagesAfter(
                    messageId,
                    req.user.id
                );

            // Send info that messages were deleted
            res.write(
                `data: ${JSON.stringify({ type: 'messages_deleted', data: { chatId, userMessage } })}\n\n`
            );

            // Stream new response
            const dto: SendMessageDto = {
                message: userMessage.content,
                imageUrl: userMessage.imageUrl,
                documentId: userMessage.documentId,
                documentName: userMessage.documentName,
            };

            let assistantMessage: any = null;
            for await (const chunk of this.aiChatService.streamMessage(
                chatId,
                req.user.id,
                dto
            )) {
                if (typeof chunk === 'string') {
                    res.write(
                        `data: ${JSON.stringify({ type: 'chunk', data: chunk })}\n\n`
                    );
                } else {
                    // This is the MessageResponseDto yielded at the end
                    assistantMessage = chunk;
                }
            }

            res.write(
                `data: ${JSON.stringify({ type: 'done', data: { assistantMessage } })}\n\n`
            );
            res.end();
        } catch (error: any) {
            res.write(
                `data: ${JSON.stringify({ type: 'error', data: error.message || 'An error occurred' })}\n\n`
            );
            res.end();
        }
    }
}
