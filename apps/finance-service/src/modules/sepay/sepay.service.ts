import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { PAYMENT_SYSTEM_CODE } from '../../config/index';

@Injectable()
export class SePayService {
    private readonly apiKey: string;
    private logger = new Logger(SePayService.name);
    private readonly baseUrl: string;
    private readonly accountNumber: string;
    private readonly bankId: string;

    constructor() {
        this.apiKey = process.env.PAYMENT_SERVICE_SEPAY_KEY ?? '';
        this.baseUrl = process.env.PAYMENT_BASE_URL ?? 'https://my.sepay.vn';
        this.accountNumber = process.env.PAYMENT_QR_BANK_ACCOUNT ?? '';
        this.bankId = process.env.PAYMENT_QR_BANK_CODE ?? 'sepay';
        if (
            !this.apiKey ||
            !this.baseUrl ||
            !this.accountNumber ||
            !this.bankId
        ) {
            throw new BadGatewayException(
                'SePay configuration is not set properly. Please check your environment variables.'
            );
        }
    }

    async createQR(amount: number, paymentId: string) {
        const bank = await this.getBankAccount();
        return {
            QR: `https://qr.sepay.vn/img?acc=${this.accountNumber}&bank=${this.bankId}&amount=${amount}&des=${PAYMENT_SYSTEM_CODE}${paymentId.toUpperCase()}`,
            bank: bank.bankaccounts[0],
        };
    }

    async getBankAccount() {
        try {
            // Gọi API SePay
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
            this.logger.error(`Error payment status: ${error.message}`);
            throw new BadGatewayException('System error', error.message);
        }
    }
}
