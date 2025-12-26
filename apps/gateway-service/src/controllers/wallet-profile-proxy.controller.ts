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

// ==================== WALLET & PAYMENT ====================

@ApiTags('Wallet')
@Controller('wallet')
@ApiBearerAuth('access-token')
export class WalletProxyController {
    constructor(private readonly proxyService: ProxyService) {}

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
    constructor(private readonly proxyService: ProxyService) {}

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
    @ApiOperation({ summary: 'Upload avatar' })
    async uploadAvatar(@Body() body: any, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'auth',
            {
                method: 'POST',
                path: '/api/v1/profile/upload-avatar',
                body,
                headers: this.h(req),
            },
            this.t(req)
        );
    }

    @Post('upload-banner')
    @ApiOperation({ summary: 'Upload banner' })
    async uploadBanner(@Body() body: any, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'auth',
            {
                method: 'POST',
                path: '/api/v1/profile/upload-banner',
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
            : req.cookies?.token || req.cookies?.accessToken || '';
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
            { method: 'GET', path: '/api/v1/devices', headers: this.h(req) },
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
