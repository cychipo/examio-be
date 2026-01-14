import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { Request } from 'express';
import { ProxyService } from '../services/proxy.service';

@ApiTags('Student')
@Controller('student')
@ApiBearerAuth('access-token')
export class StudentProxyController {
    constructor(private readonly proxyService: ProxyService) {}

    @Get('recent-flashcards')
    @ApiOperation({ summary: 'Get recent flashcard sets viewed by student' })
    @ApiQuery({ name: 'limit', required: false, type: Number })
    async getRecentFlashcards(@Req() req: Request, @Query() query: any) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: '/api/v1/student/recent-flashcards',
                query,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get('recent-exams')
    @ApiOperation({ summary: 'Get recent exam attempts by student' })
    @ApiQuery({ name: 'limit', required: false, type: Number })
    async getRecentExams(@Req() req: Request, @Query() query: any) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: '/api/v1/student/recent-exams',
                query,
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
            : req.cookies?.token || req.cookies?.accessToken || '';
    }
}
