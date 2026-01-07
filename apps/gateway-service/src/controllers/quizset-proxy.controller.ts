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
    UseInterceptors,
    UploadedFile,
} from '@nestjs/common';
import {
    ApiTags,
    ApiOperation,
    ApiResponse,
    ApiBearerAuth,
    ApiQuery,
} from '@nestjs/swagger';
import { Request } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ProxyService } from '../services/proxy.service';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as FormData from 'form-data';

@ApiTags('Quizsets')
@Controller('quizsets')
@ApiBearerAuth('access-token')
export class QuizsetProxyController {
    constructor(
        private readonly proxyService: ProxyService,
        private readonly httpService: HttpService
    ) {}

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

    @Get(':id/questions')
    @ApiOperation({ summary: 'Lấy danh sách câu hỏi có phân trang' })
    async getQuestions(
        @Param('id') id: string,
        @Query() query: any,
        @Req() req: Request
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: `/api/v1/quizsets/${id}/questions`,
                query,
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
    @UseInterceptors(FileInterceptor('thumbnail'))
    @ApiOperation({ summary: 'Tạo quiz set mới' })
    async create(
        @Body() body: any,
        @Req() req: Request,
        @UploadedFile() thumbnail?: Express.Multer.File
    ) {
        // If thumbnail file exists, forward as multipart/form-data
        if (thumbnail) {
            return this.forwardWithFile(
                'POST',
                '/api/v1/quizsets',
                body,
                thumbnail,
                req
            );
        }

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
    @UseInterceptors(FileInterceptor('thumbnail'))
    @ApiOperation({ summary: 'Cập nhật quiz set' })
    async update(
        @Param('id') id: string,
        @Body() body: any,
        @Req() req: Request,
        @UploadedFile() thumbnail?: Express.Multer.File
    ) {
        // If thumbnail file exists, forward as multipart/form-data
        if (thumbnail) {
            return this.forwardWithFile(
                'PUT',
                `/api/v1/quizsets/${id}`,
                body,
                thumbnail,
                req
            );
        }

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

    // ==================== LABEL CRUD ====================

    @Get(':quizSetId/labels')
    @ApiOperation({ summary: 'Lấy danh sách labels' })
    async getLabels(
        @Param('quizSetId') quizSetId: string,
        @Req() req: Request
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: `/api/v1/quizsets/${quizSetId}/labels`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Post(':quizSetId/labels')
    @ApiOperation({ summary: 'Tạo label mới' })
    async createLabel(
        @Param('quizSetId') quizSetId: string,
        @Body() body: any,
        @Req() req: Request
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'POST',
                path: `/api/v1/quizsets/${quizSetId}/labels`,
                body,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Put(':quizSetId/labels/:labelId')
    @ApiOperation({ summary: 'Cập nhật label' })
    async updateLabel(
        @Param('quizSetId') quizSetId: string,
        @Param('labelId') labelId: string,
        @Body() body: any,
        @Req() req: Request
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'PUT',
                path: `/api/v1/quizsets/${quizSetId}/labels/${labelId}`,
                body,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Delete(':quizSetId/labels/:labelId')
    @ApiOperation({ summary: 'Xóa label' })
    async deleteLabel(
        @Param('quizSetId') quizSetId: string,
        @Param('labelId') labelId: string,
        @Req() req: Request
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'DELETE',
                path: `/api/v1/quizsets/${quizSetId}/labels/${labelId}`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Post(':quizSetId/labels/:labelId/questions')
    @ApiOperation({ summary: 'Gán câu hỏi vào label' })
    async assignQuestionsToLabel(
        @Param('quizSetId') quizSetId: string,
        @Param('labelId') labelId: string,
        @Body() body: any,
        @Req() req: Request
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'POST',
                path: `/api/v1/quizsets/${quizSetId}/labels/${labelId}/questions`,
                body,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Delete(':quizSetId/labels/:labelId/questions')
    @ApiOperation({ summary: 'Gỡ câu hỏi khỏi label' })
    async removeQuestionsFromLabel(
        @Param('quizSetId') quizSetId: string,
        @Param('labelId') labelId: string,
        @Body() body: any,
        @Req() req: Request
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'DELETE',
                path: `/api/v1/quizsets/${quizSetId}/labels/${labelId}/questions`,
                body,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get(':quizSetId/labels/:labelId/questions')
    @ApiOperation({ summary: 'Lấy câu hỏi theo label' })
    async getQuestionsByLabel(
        @Param('quizSetId') quizSetId: string,
        @Param('labelId') labelId: string,
        @Query() query: any,
        @Req() req: Request
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: `/api/v1/quizsets/${quizSetId}/labels/${labelId}/questions`,
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

    /**
     * Forward request with file as multipart/form-data
     */
    private async forwardWithFile(
        method: string,
        path: string,
        body: any,
        file: Express.Multer.File,
        req: Request
    ) {
        const formData = new FormData();

        // Append file
        formData.append('thumbnail', file.buffer, {
            filename: file.originalname,
            contentType: file.mimetype,
        });

        // Append other fields
        Object.keys(body).forEach((key) => {
            if (body[key] !== undefined && body[key] !== null) {
                formData.append(key, body[key]);
            }
        });

        const examServiceUrl =
            process.env.EXAM_SERVICE_URL || 'http://localhost:3002';
        const url = `${examServiceUrl}${path}`;

        try {
            const response = await firstValueFrom(
                this.httpService.request({
                    method,
                    url,
                    data: formData,
                    headers: {
                        ...formData.getHeaders(),
                        Authorization: `Bearer ${this.t(req)}`,
                    },
                    maxBodyLength: Infinity,
                    maxContentLength: Infinity,
                })
            );
            return response.data;
        } catch (error) {
            if (error.response) {
                throw new Error(
                    JSON.stringify(error.response.data) ||
                        'Failed to forward request'
                );
            }
            throw error;
        }
    }
}
