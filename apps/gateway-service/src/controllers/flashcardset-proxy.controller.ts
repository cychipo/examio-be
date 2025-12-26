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

@ApiTags('Flashcardsets')
@Controller('flashcardsets')
@ApiBearerAuth('access-token')
export class FlashcardsetProxyController {
    constructor(private readonly proxyService: ProxyService) {}

    @Get()
    @ApiOperation({ summary: 'Lấy danh sách flashcard sets' })
    @ApiQuery({ name: 'page', required: false })
    @ApiQuery({ name: 'limit', required: false })
    async getFlashcardSets(@Req() req: Request, @Query() query: any) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: '/api/v1/flashcardsets',
                query,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get('stats')
    @ApiOperation({ summary: 'Lấy thống kê flashcard sets' })
    async getStats(@Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: '/api/v1/flashcardsets/stats',
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
                path: '/api/v1/flashcardsets/users/search',
                query: { q },
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get(':id')
    @ApiOperation({ summary: 'Lấy chi tiết flashcard set' })
    async getById(@Param('id') id: string, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: `/api/v1/flashcardsets/${id}`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Post()
    @ApiOperation({ summary: 'Tạo flashcard set mới' })
    async create(@Body() body: any, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'POST',
                path: '/api/v1/flashcardsets',
                body,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Put(':id')
    @ApiOperation({ summary: 'Cập nhật flashcard set' })
    async update(
        @Param('id') id: string,
        @Body() body: any,
        @Req() req: Request
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'PUT',
                path: `/api/v1/flashcardsets/${id}`,
                body,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Xóa flashcard set' })
    async delete(@Param('id') id: string, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'DELETE',
                path: `/api/v1/flashcardsets/${id}`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Post('set-flashcards-to-flashcardset')
    @ApiOperation({ summary: 'Thêm flashcards vào sets' })
    async setFlashcards(@Body() body: any, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'POST',
                path: '/api/v1/flashcardsets/set-flashcards-to-flashcardset',
                body,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Post('save-history-to-flashcardset')
    @ApiOperation({ summary: 'Lưu history vào sets' })
    async saveHistory(@Body() body: any, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'POST',
                path: '/api/v1/flashcardsets/save-history-to-flashcardset',
                body,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    // ==================== FLASHCARD CRUD ====================

    @Post(':setId/flashcards')
    @ApiOperation({ summary: 'Thêm flashcard' })
    async addFlashcard(
        @Param('setId') setId: string,
        @Body() body: any,
        @Req() req: Request
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'POST',
                path: `/api/v1/flashcardsets/${setId}/flashcards`,
                body,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Put(':setId/flashcards/:cardId')
    @ApiOperation({ summary: 'Cập nhật flashcard' })
    async updateFlashcard(
        @Param('setId') setId: string,
        @Param('cardId') cardId: string,
        @Body() body: any,
        @Req() req: Request
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'PUT',
                path: `/api/v1/flashcardsets/${setId}/flashcards/${cardId}`,
                body,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Delete(':setId/flashcards/:cardId')
    @ApiOperation({ summary: 'Xóa flashcard' })
    async deleteFlashcard(
        @Param('setId') setId: string,
        @Param('cardId') cardId: string,
        @Req() req: Request
    ) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'DELETE',
                path: `/api/v1/flashcardsets/${setId}/flashcards/${cardId}`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    // ==================== SHARING & ACCESS ====================

    @Get('study/:id/access')
    @ApiOperation({ summary: 'Check access' })
    async checkAccess(@Param('id') id: string, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: `/api/v1/flashcardsets/study/${id}/access`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get('study/:id/info')
    @ApiOperation({ summary: 'Get public info' })
    async getPublicInfo(@Param('id') id: string, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: `/api/v1/flashcardsets/study/${id}/info`,
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
                path: `/api/v1/flashcardsets/study/${id}`,
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
                path: `/api/v1/flashcardsets/study/${id}/with-code`,
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
                path: `/api/v1/flashcardsets/study/${id}/verify-code`,
                body,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get(':id/sharing')
    @ApiOperation({ summary: 'Get sharing settings' })
    async getSharingSettings(@Param('id') id: string, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'exam',
            {
                method: 'GET',
                path: `/api/v1/flashcardsets/${id}/sharing`,
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
                path: `/api/v1/flashcardsets/${id}/sharing`,
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
                path: `/api/v1/flashcardsets/${id}/generate-code`,
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
