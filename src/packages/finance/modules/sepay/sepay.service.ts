import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { PAYMENT_SYSTEM_CODE } from '../../config';

@Injectable()
export class SePayService {
    private readonly apiKey: string;
    private logger = new Logger(SePayService.name);
    private readonly baseUrl: string;
    private readonly accountNumber: string;
    private readonly bankCode: string;
    private readonly bankId: string;

    constructor() {
        this.apiKey = process.env.PAYMENT_SERVICE_SEPAY_KEY ?? '';
        this.baseUrl = process.env.PAYMENT_BASE_URL ?? 'https://my.sepay.vn';
        this.accountNumber = process.env.PAYMENT_QR_BANK_ACCOUNT ?? '';
        this.bankCode = process.env.PAYMENT_QR_BANK_CODE ?? 'MB';
        this.bankId = process.env.PAYMENT_BANK_ID ?? '15746';

        if (
            !this.apiKey ||
            !this.baseUrl ||
            !this.accountNumber ||
            !this.bankCode ||
            !this.bankId
        ) {
            throw new BadGatewayException(
                'SePay configuration is not set properly. Please check your environment variables.'
            );
        }

        this.logger.log(
            `SePay initialized - Bank: ${this.bankCode}, Account: ${this.accountNumber}, Bank ID: ${this.bankId}`
        );
    }

    /**
     * Generate static QR code URL for payment
     * Uses SePay's QR code generation service
     */
    async createQR(
        amount: number,
        paymentId: string
    ): Promise<{
        qrUrl: string;
        bankInfo: {
            bankName: string;
            accountNumber: string;
            accountName: string;
        };
    }> {
        const transferContent = `${PAYMENT_SYSTEM_CODE}${paymentId}`;

        const ordVA = await this.createOrderVA({
            amount,
            order_code: transferContent,
        });

        this.logger.log(
            `QR created for payment ${paymentId}: ${amount.toLocaleString('vi-VN')} VND`
        );

        return {
            qrUrl: ordVA.data.qr_code_url,
            bankInfo: {
                bankName: ordVA.data.bank_name || 'EXAMIO',
                accountNumber: ordVA.data.va_number,
                accountName: ordVA.data.va_holder_name || 'EXAMIO',
            },
        };
    }

    /**
     * Get bank account info from SePay
     */
    async getBankAccount() {
        try {
            const response = await axios.get(
                `${this.baseUrl}/userapi/bankaccounts/list`,
                {
                    headers: {
                        Authorization: `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json',
                    },
                }
            );

            return response.data;
        } catch (error) {
            this.logger.error(`Error getting bank accounts: ${error.message}`);
            throw new BadGatewayException('System error', error.message);
        }
    }

    async createOrderVA({
        amount,
        order_code,
    }: {
        amount: number;
        order_code: string;
    }): Promise<{
        status: string;
        message: string;
        data: {
            order_id: string;
            order_code: string;
            va_number: string;
            va_holder_name: string;
            amount: number;
            status: string;
            bank_name: string;
            account_holder_name: string;
            account_number: string;
            expired_at: string;
            qr_code: string;
            qr_code_url: string;
        };
    }> {
        try {
            console.log('bank id', this.bankId);
            const res = await axios.post(
                `${this.baseUrl}/userapi/${this.bankCode.toLocaleLowerCase()}/${this.bankId}/orders`,
                {
                    amount,
                    order_code,
                    with_qrcode: true,
                },
                {
                    headers: {
                        Authorization: `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json',
                    },
                }
            );

            return res.data;
        } catch (error) {
            this.logger.error('axios error config url: ' + error.config?.url);
            this.logger.error(
                'axios error status: ' + (error.response?.status ?? error.code)
            );
            this.logger.error(
                'axios error data: ' +
                    JSON.stringify(error.response?.data ?? error.message)
            );
            throw new BadGatewayException('System error', error.message);
        }
    }
}
