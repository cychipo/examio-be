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

@ApiTags('Exam Sessions')
@Controller('examsessions')
@ApiBearerAuth('access-token')
export class ExamSessionProxyController {
    constructor(private readonly proxyService: ProxyService) {}

    @Get('list')
    @ApiOperation({ summary: 'Lấy danh sách exam sessions' })
    async list(@Req() req: Request, @Query() query: any) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: '/api/v1/examsessions/list',
                query,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get('get-by-id/:id')
    @ApiOperation({ summary: 'Lấy exam session theo ID' })
    async getById(@Param('id') id: string, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: `/api/v1/examsessions/get-by-id/${id}`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get('get-public/:id')
    @ApiOperation({ summary: 'Lấy exam session public' })
    async getPublic(@Param('id') id: string, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: `/api/v1/examsessions/get-public/${id}`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Post()
    @ApiOperation({ summary: 'Tạo exam session mới' })
    async create(@Body() body: any, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'POST',
                path: '/api/v1/examsessions',
                body,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Put(':id')
    @ApiOperation({ summary: 'Cập nhật exam session' })
    async update(
        @Param('id') id: string,
        @Body() body: any,
        @Req() req: Request
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'PUT',
                path: `/api/v1/examsessions/${id}`,
                body,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Xóa exam session' })
    async delete(@Param('id') id: string, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'DELETE',
                path: `/api/v1/examsessions/${id}`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get('users/search')
    @ApiOperation({ summary: 'Tìm users cho whitelist' })
    async searchUsers(@Req() req: Request, @Query('q') q: string) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: '/api/v1/examsessions/users/search',
                query: { q },
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    // ==================== ACCESS CONTROL ====================

    @Get('study/:id/access')
    @ApiOperation({ summary: 'Check access' })
    async checkAccess(@Param('id') id: string, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: `/api/v1/examsessions/study/${id}/access`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get('study/:id/info')
    @ApiOperation({ summary: 'Get public info' })
    async getInfo(@Param('id') id: string, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: `/api/v1/examsessions/study/${id}/info`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get('study/:id')
    @ApiOperation({ summary: 'Get for study' })
    async getForStudy(@Param('id') id: string, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: `/api/v1/examsessions/study/${id}`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Post('study/:id/with-code')
    @ApiOperation({ summary: 'Get with access code' })
    async getWithCode(
        @Param('id') id: string,
        @Body() body: any,
        @Req() req: Request
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'POST',
                path: `/api/v1/examsessions/study/${id}/with-code`,
                body,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Post('study/:id/verify-code')
    @ApiOperation({ summary: 'Verify access code' })
    async verifyCode(
        @Param('id') id: string,
        @Body() body: any,
        @Req() req: Request
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'POST',
                path: `/api/v1/examsessions/study/${id}/verify-code`,
                body,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get('study/:id/stats')
    @ApiOperation({ summary: 'Get stats' })
    async getStats(@Param('id') id: string, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: `/api/v1/examsessions/study/${id}/stats`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    // ==================== SHARING ====================

    @Get(':id/sharing')
    @ApiOperation({ summary: 'Get sharing settings' })
    async getSharingSettings(@Param('id') id: string, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: `/api/v1/examsessions/${id}/sharing`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Put(':id/sharing')
    @ApiOperation({ summary: 'Update sharing settings' })
    async updateSharingSettings(
        @Param('id') id: string,
        @Body() body: any,
        @Req() req: Request
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'PUT',
                path: `/api/v1/examsessions/${id}/sharing`,
                body,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Post(':id/generate-code')
    @ApiOperation({ summary: 'Generate access code' })
    async generateCode(@Param('id') id: string, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'POST',
                path: `/api/v1/examsessions/${id}/generate-code`,
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
