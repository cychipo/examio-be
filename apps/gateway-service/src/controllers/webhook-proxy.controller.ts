import { Controller, Post, Body, Req, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity } from '@nestjs/swagger';
import { Request } from 'express';
import { ProxyService } from '../services/proxy.service';

/**
 * Webhook Proxy Controller
 * Handles external webhook callbacks that don't require user authentication.
 * These endpoints are called by third-party services (e.g., Sepay payment gateway).
 */
@ApiTags('Webhook')
@Controller('webhook')
export class WebhookProxyController {
    private readonly logger = new Logger(WebhookProxyController.name);

    constructor(private readonly proxyService: ProxyService) {}

    /**
     * Sepay payment webhook callback
     * Called by Sepay servers when a payment is received.
     * Uses ApiKey authentication (not user JWT).
     */
    @Post('sepay')
    @ApiOperation({
        summary: 'Nhận webhook thanh toán từ SePay',
        description: 'Endpoint này được gọi bởi SePay server khi có giao dịch. Yêu cầu header: Authorization: Apikey <key>',
    })
    @ApiSecurity('sepay-apikey')
    @ApiResponse({ status: 200, description: 'Webhook xử lý thành công' })
    @ApiResponse({ status: 401, description: 'API Key không hợp lệ' })
    @ApiResponse({ status: 404, description: 'Payment không tồn tại' })
    @ApiResponse({ status: 409, description: 'Payment đã được xử lý' })
    async handleSepayWebhook(
        @Body() body: any,
        @Req() req: Request
    ) {
        this.logger.log(`Received Sepay webhook callback`);
        this.logger.debug(`Webhook body: ${JSON.stringify(body)}`);

        // Forward to finance-service with the original Authorization header (ApiKey)
        // Note: finance-service uses /api/v1 prefix
        const authorization = req.headers.authorization || '';

        return this.proxyService.forward('finance', {
            method: 'POST',
            path: '/api/v1/webhook',
            body,
            headers: {
                ...this.extractHeaders(req),
                Authorization: authorization,
            },
        });
    }

    private extractHeaders(req: Request): Record<string, string> {
        return {
            'user-agent': req.headers['user-agent'] || '',
            'x-forwarded-for':
                (req.headers['x-forwarded-for'] as string) ||
                req.socket.remoteAddress ||
                '',
            'content-type': req.headers['content-type'] || 'application/json',
        };
    }
}
