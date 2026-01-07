import { Controller, Get, Param, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { ProxyService } from '../services/proxy.service';

@ApiTags('Subjects')
@Controller('subjects')
@ApiBearerAuth('access-token')
export class SubjectProxyController {
    constructor(private readonly proxyService: ProxyService) {}

    private h(req: Request) {
        return { 'user-agent': req.headers['user-agent'] || '' };
    }

    private t(req: Request) {
        const a = req.headers.authorization;
        return a?.startsWith('Bearer ')
            ? a.substring(7)
            : req.cookies?.token || req.cookies?.accessToken || '';
    }

    @Get('categories')
    @ApiOperation({ summary: 'Lấy danh sách nhóm môn học với các môn học' })
    @ApiResponse({ status: 200, description: 'Danh sách nhóm môn học' })
    async getCategories(@Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: '/api/v1/subjects/categories',
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get()
    @ApiOperation({ summary: 'Lấy danh sách tất cả môn học' })
    @ApiResponse({ status: 200, description: 'Danh sách môn học' })
    async getSubjects(@Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: '/api/v1/subjects',
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get(':id')
    @ApiOperation({ summary: 'Lấy thông tin môn học theo ID' })
    @ApiResponse({ status: 200, description: 'Thông tin môn học' })
    @ApiResponse({ status: 404, description: 'Không tìm thấy môn học' })
    async getSubjectById(@Req() req: Request, @Param('id') id: string) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: `/api/v1/subjects/${id}`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get('slug/:slug')
    @ApiOperation({ summary: 'Lấy thông tin môn học theo slug' })
    @ApiResponse({ status: 200, description: 'Thông tin môn học' })
    @ApiResponse({ status: 404, description: 'Không tìm thấy môn học' })
    async getSubjectBySlug(@Req() req: Request, @Param('slug') slug: string) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: `/api/v1/subjects/slug/${slug}`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }
}