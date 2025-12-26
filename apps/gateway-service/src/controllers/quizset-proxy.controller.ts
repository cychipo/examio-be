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

@ApiTags('Quizsets')
@Controller('quizsets')
@ApiBearerAuth('access-token')
export class QuizsetProxyController {
    constructor(private readonly proxyService: ProxyService) {}

    @Get()
    @ApiOperation({ summary: 'Lấy danh sách quiz sets' })
    @ApiQuery({ name: 'page', required: false })
    @ApiQuery({ name: 'limit', required: false })
    @ApiQuery({ name: 'search', required: false })
    @ApiQuery({ name: 'isPublic', required: false })
    @ApiQuery({ name: 'isPinned', required: false })
    async getQuizSets(@Req() req: Request, @Query() query: any) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: '/api/v1/quizsets',
                query,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get('stats')
    @ApiOperation({ summary: 'Lấy thống kê quiz sets' })
    async getStats(@Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: '/api/v1/quizsets/stats',
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get('list/all')
    @ApiOperation({ summary: 'Lấy tất cả quiz sets' })
    async getAllQuizSets(@Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: '/api/v1/quizsets/list/all',
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get(':id')
    @ApiOperation({ summary: 'Lấy chi tiết quiz set' })
    async getById(@Param('id') id: string, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: `/api/v1/quizsets/${id}`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Post()
    @ApiOperation({ summary: 'Tạo quiz set mới' })
    async create(@Body() body: any, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'POST',
                path: '/api/v1/quizsets',
                body,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Put(':id')
    @ApiOperation({ summary: 'Cập nhật quiz set' })
    async update(
        @Param('id') id: string,
        @Body() body: any,
        @Req() req: Request
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'PUT',
                path: `/api/v1/quizsets/${id}`,
                body,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Xóa quiz set' })
    async delete(@Param('id') id: string, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'DELETE',
                path: `/api/v1/quizsets/${id}`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Post('set-quizzes-to-quizset')
    @ApiOperation({ summary: 'Thêm quizzes vào quiz sets' })
    async setQuizzesToQuizset(@Body() body: any, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'POST',
                path: '/api/v1/quizsets/set-quizzes-to-quizset',
                body,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Post('save-history-to-quizset')
    @ApiOperation({ summary: 'Lưu history vào quiz sets' })
    async saveHistoryToQuizset(@Body() body: any, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'POST',
                path: '/api/v1/quizsets/save-history-to-quizset',
                body,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    // ==================== QUESTION CRUD ====================

    @Post(':quizSetId/questions')
    @ApiOperation({ summary: 'Thêm câu hỏi vào quiz set' })
    async addQuestion(
        @Param('quizSetId') quizSetId: string,
        @Body() body: any,
        @Req() req: Request
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'POST',
                path: `/api/v1/quizsets/${quizSetId}/questions`,
                body,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Put(':quizSetId/questions/:questionId')
    @ApiOperation({ summary: 'Cập nhật câu hỏi' })
    async updateQuestion(
        @Param('quizSetId') quizSetId: string,
        @Param('questionId') questionId: string,
        @Body() body: any,
        @Req() req: Request
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'PUT',
                path: `/api/v1/quizsets/${quizSetId}/questions/${questionId}`,
                body,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Delete(':quizSetId/questions/:questionId')
    @ApiOperation({ summary: 'Xóa câu hỏi' })
    async deleteQuestion(
        @Param('quizSetId') quizSetId: string,
        @Param('questionId') questionId: string,
        @Req() req: Request
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'DELETE',
                path: `/api/v1/quizsets/${quizSetId}/questions/${questionId}`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    private h(req: Request) {
        return {
            'user-agent': req.headers['user-agent'] || '',
            'x-forwarded-for': (req.headers['x-forwarded-for'] as string) || '',
        };
    }
    private t(req: Request) {
        const a = req.headers.authorization;
        return a?.startsWith('Bearer ')
            ? a.substring(7)
            : req.cookies?.token || req.cookies?.accessToken || '';
    }
}
