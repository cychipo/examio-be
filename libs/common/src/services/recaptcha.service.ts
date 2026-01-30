import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class RecaptchaService {
    private readonly logger = new Logger(RecaptchaService.name);
    private readonly secretKey = process.env.RECAPTCHA_SECRET_KEY;

    /**
     * Verify reCAPTCHA token with Google
     * @param token reCAPTCHA token from frontend
     * @param action Expected action name
     * @param minScore Minimum score allowed (v3 only, default 0.5)
     */
    async verify(
        token: string,
        action: string,
        minScore = 0.5
    ): Promise<boolean> {
        // Skip verification if no secret key is configured (dev mode)
        if (!this.secretKey) {
            this.logger.warn(
                'RECAPTCHA_SECRET_KEY not configured. Skipping verification.'
            );
            return true;
        }

        if (!token) {
            throw new BadRequestException('reCAPTCHA token is required');
        }

        try {
            const response = await axios.post(
                `https://www.google.com/recaptcha/api/siteverify?secret=${this.secretKey}&response=${token}`
            );

            const data = response.data;

            if (!data.success) {
                this.logger.error(
                    `reCAPTCHA verification failed: ${JSON.stringify(data)}`
                );
                throw new BadRequestException('Xác thực reCAPTCHA thất bại');
            }

            // For v3, also check action and score
            if (data.action && data.action !== action) {
                this.logger.error(
                    `reCAPTCHA action mismatch: expected ${action}, got ${data.action}`
                );
                throw new BadRequestException(
                    'Hành động reCAPTCHA không hợp lệ'
                );
            }

            if (data.score !== undefined && data.score < minScore) {
                this.logger.error(
                    `reCAPTCHA score too low: ${data.score} < ${minScore}`
                );
                throw new BadRequestException(
                    'Hệ thống nghi ngờ bạn là bot. Vui lòng thử lại.'
                );
            }

            return true;
        } catch (error) {
            if (error instanceof BadRequestException) {
                throw error;
            }
            this.logger.error(`Error verifying reCAPTCHA: ${error.message}`);
            throw new BadRequestException('Lỗi khi xác thực bảo mật');
        }
    }
}
