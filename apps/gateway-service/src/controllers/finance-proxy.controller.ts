import { Controller, Get, Post, Body, Req, Query } from '@nestjs/common';
import {
    ApiTags,
    ApiOperation,
    ApiResponse,
    ApiBearerAuth,
    ApiQuery,
} from '@nestjs/swagger';
import { Request } from 'express';
import { ProxyService } from '../services/proxy.service';

@ApiTags('Finance')
@Controller('finance')
@ApiBearerAuth('access-token')
export class FinanceProxyController {
    constructor(private readonly proxyService: ProxyService) {}

    // ==================== WALLET ====================

    @Get('wallet')
    @ApiOperation({ summary: 'Lấy thông tin ví' })
    @ApiResponse({ status: 200, description: 'Wallet info' })
    async getWallet(@Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'finance',
            {
                method: 'GET',
                path: '/api/v1/wallet',
                headers: this.extractHeaders(req),
            },
            this.extractToken(req)
        );
    }

    @Get('wallet/transactions')
    @ApiOperation({ summary: 'Lấy lịch sử giao dịch' })
    @ApiQuery({ name: 'page', required: false, type: Number })
    @ApiQuery({ name: 'limit', required: false, type: Number })
    @ApiResponse({ status: 200, description: 'Transaction history' })
    async getTransactions(@Req() req: Request, @Query() query: any) {
        return this.proxyService.forwardWithAuth(
            'finance',
            {
                method: 'GET',
                path: '/api/v1/wallet/transactions',
                query,
                headers: this.extractHeaders(req),
            },
            this.extractToken(req)
        );
    }

    // ==================== PAYMENT ====================

    @Post('payment/create')
    @ApiOperation({ summary: 'Tạo thanh toán mới' })
    @ApiResponse({ status: 201, description: 'Payment created with QR code' })
    async createPayment(@Body() body: any, @Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'finance',
            {
                method: 'POST',
                path: '/api/v1/payment/create',
                body,
                headers: this.extractHeaders(req),
            },
            this.extractToken(req)
        );
    }

    @Get('payment/status/:id')
    @ApiOperation({ summary: 'Kiểm tra trạng thái thanh toán' })
    @ApiResponse({ status: 200, description: 'Payment status' })
    async getPaymentStatus(@Req() req: Request) {
        const id = req.params.id;
        return this.proxyService.forwardWithAuth(
            'finance',
            {
                method: 'GET',
                path: `/api/v1/payment/status/${id}`,
                headers: this.extractHeaders(req),
            },
            this.extractToken(req)
        );
    }

    // ==================== SUBSCRIPTION ====================

    @Get('subscription')
    @ApiOperation({ summary: 'Lấy thông tin gói đăng ký' })
    @ApiResponse({ status: 200, description: 'Subscription info' })
    async getSubscription(@Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'finance',
            {
                method: 'GET',
                path: '/api/v1/subscription',
                headers: this.extractHeaders(req),
            },
            this.extractToken(req)
        );
    }

    @Get('subscription/plans')
    @ApiOperation({ summary: 'Lấy danh sách các gói đăng ký' })
    @ApiResponse({ status: 200, description: 'Available plans' })
    async getPlans(@Req() req: Request) {
        return this.proxyService.forwardWithAuth(
            'finance',
            {
                method: 'GET',
                path: '/api/v1/subscription/plans',
                headers: this.extractHeaders(req),
            },
            this.extractToken(req)
        );
    }

    private extractHeaders(req: Request): Record<string, string> {
        return {
            'user-agent': req.headers['user-agent'] || '',
            'x-forwarded-for':
                (req.headers['x-forwarded-for'] as string) ||
                req.socket.remoteAddress ||
                '',
        };
    }

    private extractToken(req: Request): string {
        const authHeader = req.headers.authorization;
        if (authHeader?.startsWith('Bearer ')) {
            return authHeader.substring(7);
        }
        return req.cookies?.token || req.cookies?.accessToken || '';
    }
}
