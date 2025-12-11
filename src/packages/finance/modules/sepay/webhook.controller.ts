import { Body, Controller, Post, Logger, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SepayWebhook } from '../../types/webhook';
import { WebhookService } from './webhook.service';

@ApiTags('Webhook')
@Controller('webhook')
export class WebhookController {
    private readonly logger = new Logger(WebhookController.name);

    constructor(private readonly webhookService: WebhookService) {}

    /**
     * Endpoint nhận webhook từ SePay
     * Không cần authentication vì được gọi từ SePay server
     */
    @Post('')
    @ApiOperation({ summary: 'Nhận webhook thanh toán từ SePay' })
    @ApiResponse({ status: 200, description: 'Webhook xử lý thành công' })
    @ApiResponse({ status: 404, description: 'Payment không tồn tại' })
    @ApiResponse({ status: 409, description: 'Payment đã được xử lý' })
    async handleSepayWebhook(
        @Headers() headers,
        @Body() webhookData: SepayWebhook
    ): Promise<{ success: boolean; message?: string }> {
        this.logger.log(
            `Received SePay webhook: ${JSON.stringify(webhookData)}`,
            headers
        );

        const authHeader = headers.authorization;
        const apiKey = authHeader?.replace(/^Apikey\s+/i, '').trim();
        console.log(
            '🚀 ~ WebhookController ~ handleSepayWebhook ~ apiKey:',
            apiKey
        );

        if (!webhookData || !webhookData.content) {
            this.logger.warn('Invalid webhook data received');
            return { success: false, message: 'Invalid data' };
        }

        if (!apiKey) {
            this.logger.warn('Invalid API key');
            return { success: false, message: 'Invalid API key' };
        }

        try {
            return await this.webhookService.processWebhook(
                webhookData,
                apiKey
            );
        } catch (error) {
            this.logger.error(`Webhook processing failed: ${error.message}`);
            return { success: false, message: error.message };
        }
    }
}
