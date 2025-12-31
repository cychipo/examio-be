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
    ApiBearerAuth,
    ApiQuery,
} from '@nestjs/swagger';
import { Request } from 'express';
import { ProxyService } from '../services/proxy.service';

@ApiTags('Exam Rooms')
@Controller('examrooms')
@ApiBearerAuth('access-token')
export class ExamRoomProxyController {
    constructor(private readonly proxyService: ProxyService) {}

    @Get('list')
    @ApiOperation({ summary: 'Lấy danh sách exam rooms' })
    async list(@Req() req: Request, @Query() query: any) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: '/api/v1/examrooms/list',
                query,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get('list-all')
    @ApiOperation({ summary: 'Lấy tất cả exam rooms' })
    async listAll(@Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: '/api/v1/examrooms/list-all',
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get('detail/:id')
    @ApiOperation({ summary: 'Lấy chi tiết exam room' })
    async getById(@Param('id') id: string, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: `/api/v1/examrooms/detail/${id}`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get('get-public/:id')
    @ApiOperation({ summary: 'Lấy exam room public' })
    async getPublic(@Param('id') id: string, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: `/api/v1/examrooms/get-public/${id}`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Post()
    @ApiOperation({ summary: 'Tạo exam room mới' })
    async create(@Body() body: any, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'POST',
                path: '/api/v1/examrooms',
                body,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Put(':id')
    @ApiOperation({ summary: 'Cập nhật exam room' })
    async update(
        @Param('id') id: string,
        @Body() body: any,
        @Req() req: Request
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'PUT',
                path: `/api/v1/examrooms/${id}`,
                body,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Xóa exam room' })
    async delete(@Param('id') id: string, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'DELETE',
                path: `/api/v1/examrooms/${id}`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get(':examRoomId/sessions')
    @ApiOperation({ summary: 'Lấy sessions của exam room' })
    async getSessions(
        @Param('examRoomId') examRoomId: string,
        @Req() req: Request,
        @Query() query: any
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: `/api/v1/examrooms/${examRoomId}/sessions`,
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
