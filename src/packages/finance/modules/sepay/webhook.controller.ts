import { Body, Controller, Post, Logger } from '@nestjs/common';
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
        @Body() webhookData: SepayWebhook
    ): Promise<{ success: boolean; message?: string }> {
        console.log('Received SePay webhook: ', webhookData);
        this.logger.log(
            `Received SePay webhook: ${JSON.stringify(webhookData)}`
        );

        if (!webhookData || !webhookData.content) {
            this.logger.warn('Invalid webhook data received');
            return { success: false, message: 'Invalid data' };
        }

        try {
            return await this.webhookService.processWebhook(webhookData);
        } catch (error) {
            this.logger.error(`Webhook processing failed: ${error.message}`);
            // Vẫn trả về success để SePay không retry
            // Lỗi đã được log để xử lý thủ công
            return { success: false, message: error.message };
        }
    }
}
