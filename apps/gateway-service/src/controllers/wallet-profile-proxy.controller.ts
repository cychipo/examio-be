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
import { FileInterceptor } from '@nestjs/platform-express';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as FormData from 'form-data';
import {
    ApiTags,
    ApiOperation,
    ApiBearerAuth,
    ApiQuery,
} from '@nestjs/swagger';
import { Request } from 'express';
import { ProxyService } from '../services/proxy.service';

// ==================== WALLET & PAYMENT ====================

@ApiTags('Wallet')
@Controller('wallet')
@ApiBearerAuth('access-token')
export class WalletProxyController {
    constructor(
        private readonly proxyService: ProxyService,
        private readonly httpService: HttpService
    ) {}

    @Get('details')
    @ApiOperation({ summary: 'Lấy chi tiết ví với transactions' })
    async getDetails(@Req() req: Request, @Query() query: any) {
        return this.proxyService.forwardWithAuth(
            'finance',
            {
                method: 'GET',
                path: '/api/v1/wallet/details',
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

@ApiTags('Payment')
@Controller('payment')
@ApiBearerAuth('access-token')
export class PaymentProxyController {
    constructor(private readonly proxyService: ProxyService) {}

    @Post('create')
    @ApiOperation({ summary: 'Tạo thanh toán mới (credits/subscription)' })
    async create(@Body() body: any, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'finance',
            {
                method: 'POST',
                path: '/api/v1/payment/create',
                body,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get('status/:paymentId')
    @ApiOperation({ summary: 'Kiểm tra trạng thái thanh toán' })
    async getStatus(
        @Param('paymentId') paymentId: string,
        @Req() req: Request
    ) {
        return this.proxyService.forwardWithAuth(
            'finance',
            {
                method: 'GET',
                path: `/api/v1/payment/status/${paymentId}`,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get('subscription')
    @ApiOperation({ summary: 'Lấy thông tin gói đăng ký' })
    async getSubscription(@Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'finance',
            {
                method: 'GET',
                path: '/api/v1/payment/subscription',
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Get('subscription/plans')
    @ApiOperation({ summary: 'Lấy danh sách gói đăng ký' })
    async getPlans(@Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'finance',
            {
                method: 'GET',
                path: '/api/v1/payment/subscription/plans',
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Delete('cancel/:paymentId')
    @ApiOperation({ summary: 'Hủy thanh toán pending' })
    async cancel(@Param('paymentId') paymentId: string, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'finance',
            {
                method: 'DELETE',
                path: `/api/v1/payment/cancel/${paymentId}`,
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

// ==================== PROFILE ====================

@ApiTags('Profile')
@Controller('profile')
@ApiBearerAuth('access-token')
export class ProfileProxyController {
    constructor(
        private readonly proxyService: ProxyService,
        private readonly httpService: HttpService
    ) {}

    @Get()
    @ApiOperation({ summary: 'Lấy thông tin profile' })
    async getProfile(@Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'auth',
            { method: 'GET', path: '/api/v1/profile', headers: this.h(req) },
            this.t(req)
        );
    }

    @Put()
    @ApiOperation({ summary: 'Cập nhật profile' })
    async updateProfile(@Body() body: any, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'auth',
            {
                method: 'PUT',
                path: '/api/v1/profile',
                body,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Post('upload-avatar')
    @UseInterceptors(FileInterceptor('file'))
    @ApiOperation({ summary: 'Upload avatar' })
    async uploadAvatar(
        @Req() req: Request,
        @UploadedFile() file: Express.Multer.File
    ) {
        if (!file) {
            throw new Error('No file uploaded');
        }
        return this.forwardWithFile(
            'POST',
            '/api/v1/profile/upload-avatar',
            file,
            req
        );
    }

    @Post('upload-banner')
    @UseInterceptors(FileInterceptor('file'))
    @ApiOperation({ summary: 'Upload banner' })
    async uploadBanner(
        @Req() req: Request,
        @UploadedFile() file: Express.Multer.File
    ) {
        if (!file) {
            throw new Error('No file uploaded');
        }
        return this.forwardWithFile(
            'POST',
            '/api/v1/profile/upload-banner',
            file,
            req
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
     * Forward request with file as multipart/form-data to auth service
     */
    private async forwardWithFile(
        method: string,
        path: string,
        file: Express.Multer.File,
        req: Request
    ) {
        console.log('forwardWithFile - file info:', {
            filename: file.originalname,
            mimetype: file.mimetype,
            size: file.size,
            hasBuffer: !!file.buffer,
            bufferLength: file.buffer?.length,
        });

        const formData = new FormData();

        // Append file with buffer
        formData.append('file', file.buffer, {
            filename: file.originalname,
            contentType: file.mimetype,
        });

        const authServiceUrl =
            process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
        const url = `${authServiceUrl}${path}`;

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
            console.error('forwardWithFile error:', {
                status: error.response?.status,
                data: error.response?.data,
                message: error.message,
            });
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

// ==================== DEVICES ====================

@ApiTags('Devices')
@Controller('devices')
@ApiBearerAuth('access-token')
export class DevicesProxyController {
    constructor(private readonly proxyService: ProxyService) {}

    @Get()
    @ApiOperation({ summary: 'Lấy danh sách thiết bị đăng nhập' })
    async getDevices(@Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'auth',
            {
                method: 'GET',
                path: '/api/v1/devices',
                headers: this.h(req),
                cookies: req.cookies,
            },
            this.t(req)
        );
    }

    @Delete(':sessionId')
    @ApiOperation({ summary: 'Đăng xuất thiết bị' })
    async logoutDevice(
        @Param('sessionId') sessionId: string,
        @Req() req: Request
    ) {
        return this.proxyService.forwardWithAuth(
            'auth',
            {
                method: 'DELETE',
                path: `/api/v1/devices/${sessionId}`,
                headers: this.h(req),
                cookies: req.cookies,
            },
            this.t(req)
        );
    }

    @Post('logout-all-others')
    @ApiOperation({ summary: 'Đăng xuất tất cả thiết bị khác' })
    async logoutAllOthers(@Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'auth',
            {
                method: 'POST',
                path: '/api/v1/devices/logout-all-others',
                headers: this.h(req),
                cookies: req.cookies,
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
