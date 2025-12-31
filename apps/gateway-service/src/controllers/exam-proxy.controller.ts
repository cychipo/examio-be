import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Param,
    Body,
    Query,
    Req,
} from '@nestjs/common';
import {
    ApiTags,
    ApiOperation,
    ApiResponse,
    ApiBearerAuth,
    ApiQuery,
} from '@nestjs/swagger';
import { Request } from 'express';
import { ProxyService } from '../services/proxy.service';

@ApiTags('Exam')
@Controller('exam')
@ApiBearerAuth('access-token')
export class ExamProxyController {
    constructor(private readonly proxyService: ProxyService) {}

    // ==================== QUIZSET ====================

    @Get('quizsets')
    @ApiOperation({ summary: 'Lấy danh sách Quiz Sets' })
    @ApiQuery({ name: 'page', required: false, type: Number })
    @ApiQuery({ name: 'limit', required: false, type: Number })
    @ApiResponse({ status: 200, description: 'Danh sách quiz sets' })
    async getQuizSets(@Req() req: Request, @Query() query: any) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: '/api/v1/quizset',
                query,
                headers: this.extractHeaders(req),
            },
            this.extractToken(req)
        );
    }

    @Get('quizsets/:id')
    @ApiOperation({ summary: 'Lấy chi tiết Quiz Set' })
    @ApiResponse({ status: 200, description: 'Quiz set detail' })
    async getQuizSet(@Param('id') id: string, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: `/api/v1/quizset/${id}`,
                headers: this.extractHeaders(req),
            },
            this.extractToken(req)
        );
    }

    @Post('quizsets')
    @ApiOperation({ summary: 'Tạo Quiz Set mới' })
    @ApiResponse({ status: 201, description: 'Quiz set created' })
    async createQuizSet(@Body() body: any, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'POST',
                path: '/api/v1/quizset',
                body,
                headers: this.extractHeaders(req),
            },
            this.extractToken(req)
        );
    }

    // ==================== FLASHCARD ====================

    @Get('flashcards')
    @ApiOperation({ summary: 'Lấy danh sách Flashcard Sets' })
    @ApiQuery({ name: 'page', required: false, type: Number })
    @ApiQuery({ name: 'limit', required: false, type: Number })
    @ApiResponse({ status: 200, description: 'Danh sách flashcard sets' })
    async getFlashcardSets(@Req() req: Request, @Query() query: any) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: '/api/v1/flashcardset',
                query,
                headers: this.extractHeaders(req),
            },
            this.extractToken(req)
        );
    }

    @Get('flashcards/:id')
    @ApiOperation({ summary: 'Lấy chi tiết Flashcard Set' })
    @ApiResponse({ status: 200, description: 'Flashcard set detail' })
    async getFlashcardSet(@Param('id') id: string, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: `/api/v1/flashcardset/${id}`,
                headers: this.extractHeaders(req),
            },
            this.extractToken(req)
        );
    }

    // ==================== EXAM ROOM ====================

    @Get('rooms')
    @ApiOperation({ summary: 'Lấy danh sách Exam Rooms' })
    @ApiResponse({ status: 200, description: 'Danh sách exam rooms' })
    async getExamRooms(@Req() req: Request, @Query() query: any) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: '/api/v1/examroom',
                query,
                headers: this.extractHeaders(req),
            },
            this.extractToken(req)
        );
    }

    @Post('rooms/:code/join')
    @ApiOperation({ summary: 'Tham gia Exam Room' })
    @ApiResponse({ status: 200, description: 'Joined exam room' })
    async joinExamRoom(@Param('code') code: string, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'POST',
                path: `/api/v1/examroom/${code}/join`,
                headers: this.extractHeaders(req),
            },
            this.extractToken(req)
        );
    }

    private extractHeaders(req: Request): Record<string, string> {
        return {
            'user-agent': req.headers['user-agent'] || '',
            'x-forwarded-for':
                (req.headers['x-forwarded-for'] as string) ||
                req.socket.remoteAddress ||
                '',
        };
    }

    private extractToken(req: Request): string {
        const authHeader = req.headers.authorization;
        if (authHeader?.startsWith('Bearer ')) {
            return authHeader.substring(7);
        }
        return req.cookies?.token || req.cookies?.accessToken || '';
    }
}
