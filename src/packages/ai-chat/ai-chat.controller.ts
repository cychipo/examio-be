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
} from '@nestjs/common';
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
}
