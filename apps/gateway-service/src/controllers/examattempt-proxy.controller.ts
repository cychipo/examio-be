import {
    Controller,
    Get,
    Post,
    Put,
    Param,
    Body,
    Query,
    Req,
} from '@nestjs/common';
import {
    ApiTags,
    ApiOperation,
    ApiBearerAuth,
    ApiQuery,
} from '@nestjs/swagger';
import { Request } from 'express';
import { ProxyService } from '../services/proxy.service';

@ApiTags('Exam Attempts')
@Controller('examattempts')
@ApiBearerAuth('access-token')
export class ExamAttemptProxyController {
    constructor(private readonly proxyService: ProxyService) {}

    @Post('start')
    @ApiOperation({ summary: 'Bắt đầu/Resume exam attempt' })
    async start(@Body() body: any, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'POST',
                path: '/api/v1/examattempts/start',
                body,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get('list')
    @ApiOperation({ summary: 'Lấy danh sách exam attempts' })
    async list(@Req() req: Request, @Query() query: any) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: '/api/v1/examattempts/list',
                query,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get('history-stats')
    @ApiOperation({ summary: 'Lấy thống kê lịch sử' })
    async historyStats(@Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: '/api/v1/examattempts/history-stats',
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get('list-by-room/:examRoomId')
    @ApiOperation({ summary: 'Lấy attempts theo room (owner)' })
    async listByRoom(
        @Param('examRoomId') examRoomId: string,
        @Req() req: Request,
        @Query() query: any
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: `/api/v1/examattempts/list-by-room/${examRoomId}`,
                query,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get('list-by-session/:sessionId')
    @ApiOperation({ summary: 'Lấy attempts theo session (owner)' })
    async listBySession(
        @Param('sessionId') sessionId: string,
        @Req() req: Request,
        @Query() query: any
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: `/api/v1/examattempts/list-by-session/${sessionId}`,
                query,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get(':attemptId/quiz')
    @ApiOperation({ summary: 'Get attempt with questions' })
    async getQuiz(@Param('attemptId') attemptId: string, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: `/api/v1/examattempts/${attemptId}/quiz`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get(':attemptId/detail')
    @ApiOperation({ summary: 'Get attempt detail (owner)' })
    async getDetail(
        @Param('attemptId') attemptId: string,
        @Req() req: Request
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: `/api/v1/examattempts/${attemptId}/detail`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Put(':attemptId/progress')
    @ApiOperation({ summary: 'Cập nhật progress (auto-save)' })
    async updateProgress(
        @Param('attemptId') attemptId: string,
        @Body() body: any,
        @Req() req: Request
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'PUT',
                path: `/api/v1/examattempts/${attemptId}/progress`,
                body,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Post(':attemptId/submit')
    @ApiOperation({ summary: 'Nộp bài' })
    async submit(@Param('attemptId') attemptId: string, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'POST',
                path: `/api/v1/examattempts/${attemptId}/submit`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    // ==================== SECURE QUIZ ====================

    @Get(':attemptId/secure-quiz')
    @ApiOperation({ summary: 'Get secure quiz with encrypted questions' })
    async getSecureQuiz(
        @Param('attemptId') attemptId: string,
        @Req() req: Request
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: `/api/v1/examattempts/${attemptId}/secure-quiz`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Post(':attemptId/secure-submit')
    @ApiOperation({ summary: 'Submit with JWT verification' })
    async secureSubmit(
        @Param('attemptId') attemptId: string,
        @Body() body: any,
        @Req() req: Request
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'POST',
                path: `/api/v1/examattempts/${attemptId}/secure-submit`,
                body,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    private h(req: Request) {
        return { 'user-agent': req.headers['user-agent'] || '' };
    }
    private t(req: Request) {
        const a = req.headers.authorization;
        return a?.startsWith('Bearer ')
            ? a.substring(7)
            : req.cookies?.accessToken || '';
    }
}
