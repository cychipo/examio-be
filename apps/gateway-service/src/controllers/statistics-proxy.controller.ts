import { Controller, Get, Req, UseGuards, Logger, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { Request } from 'express';
import { ProxyService } from '../services/proxy.service';

@ApiTags('Statistics')
@Controller('statistics')
@ApiBearerAuth('access-token')
export class StatisticsProxyController {
    private readonly logger = new Logger(StatisticsProxyController.name);

    constructor(private readonly proxyService: ProxyService) {}

    @Get('teacher')
    @ApiOperation({ summary: 'Get dashboard statistics for teachers' })
    @ApiQuery({ name: 'range', enum: ['7d', '30d'], required: false })
    async getTeacherStats(@Req() req: Request, @Query() query: any) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: '/api/v1/statistics/teacher',
                query,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get('student')
    @ApiOperation({ summary: 'Get dashboard statistics for students' })
    @ApiQuery({ name: 'range', enum: ['7d', '30d'], required: false })
    async getStudentStats(@Req() req: Request, @Query() query: any) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: '/api/v1/statistics/student',
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
