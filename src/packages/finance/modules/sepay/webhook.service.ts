import {
    Injectable,
    NotFoundException,
    ConflictException,
    ForbiddenException,
    Logger,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { SepayWebhook } from '../../types/webhook';
import { getPaymentIdFromWebhook } from '../../utils/handleWebhook';
import { PAYMENT_STATUS } from '../../types/payment';
import { WalletRepository } from '../wallet/wallet.repository';
import { WalletTransactionRepository } from '../wallet/wallettransaction.repository';
import { GenerateIdService } from 'src/common/services/generate-id.service';
import { WALLET_TRANSACTION_TYPE } from '../wallet/dto/wallet-details-response.dto';
import { SubscriptionService } from './subscription.service';
import {
    SUBSCRIPTION_TIER,
    getSubscriptionTierFromPrice,
} from '../../types/subscription';

@Injectable()
export class WebhookService {
    private readonly logger = new Logger(WebhookService.name);
    private readonly webhookSecretKey = process.env.PAYMENT_WEBHOOK_SECRET_KEY;

    constructor(
        private readonly prisma: PrismaService,
        private readonly walletRepository: WalletRepository,
        private readonly walletTransactionRepository: WalletTransactionRepository,
        private readonly generateIdService: GenerateIdService,
        private readonly subscriptionService: SubscriptionService
    ) {}

    /**
     * Xử lý webhook từ SePay khi có giao dịch chuyển khoản
     * 1. Parse paymentId từ nội dung
     * 2. Validate payment tồn tại và chưa thanh toán
     * 3. Cập nhật payment status = PAID
     * 4. Dựa vào paymentType:
     *    - credits: Cộng credits vào wallet
     *    - subscription: Kích hoạt/nâng cấp subscription
     */
    async processWebhook(
        data: SepayWebhook,
        apiKey: string
    ): Promise<{ success: boolean }> {
        if (apiKey !== this.webhookSecretKey) {
            this.logger.warn(`Invalid API key: ${apiKey}`);
            return { success: false };
        }

        // Chỉ xử lý tiền vào
        if (data.transferType !== 'in') {
            this.logger.log(
                `Ignoring outgoing transfer: ${data.referenceCode}`
            );
            return { success: true };
        }

        const paymentId = getPaymentIdFromWebhook(data.content);

        if (!paymentId) {
            this.logger.warn(
                `Cannot extract paymentId from content: ${data.content}`
            );
            return { success: false };
        }

        this.logger.log(`Processing payment: ${paymentId}`);

        // Tìm payment
        const payment = await this.prisma.payment.findUnique({
            where: { id: paymentId },
        });

        if (!payment) {
            this.logger.warn(`Payment not found: ${paymentId}`);
            throw new NotFoundException('Payment not found');
        }

        // Kiểm tra trạng thái
        if (payment.status === PAYMENT_STATUS.PAID) {
            this.logger.warn(`Payment already processed: ${paymentId}`);
            throw new ConflictException(
                'This payment has already been processed'
            );
        }

        if (payment.status === PAYMENT_STATUS.CANCELED) {
            this.logger.warn(`Payment was cancelled: ${paymentId}`);
            throw new ForbiddenException(
                'This payment has been canceled and cannot be processed'
            );
        }

        if (payment.status === PAYMENT_STATUS.OVERDUE) {
            this.logger.warn(`Payment is overdue: ${paymentId}`);
            throw new ForbiddenException(
                'This payment is overdue and cannot be processed'
            );
        }

        // Số tiền nhận được
        const amountReceived = data.transferAmount;

        // Kiểm tra số tiền có khớp không (cho phép sai số nhỏ do phí)
        if (amountReceived < payment.amount * 0.95) {
            this.logger.warn(
                `Amount mismatch: expected ${payment.amount}, got ${amountReceived}`
            );
            // Vẫn xử lý nhưng ghi log
        }

        // Xử lý dựa vào paymentType
        console.log('🚀 ~ WebhookService ~ processWebhook ~ payment:', payment);
        if (payment.paymentType === 'subscription') {
            console.log('Processing subscription payment');
            await this.processSubscriptionPayment(
                payment,
                paymentId,
                amountReceived
            );
        } else {
            console.log('Processing credit payment');
            await this.processCreditPayment(payment, paymentId, amountReceived);
        }

        return { success: true };
    }

    /**
     * Xử lý thanh toán mua credits
     */
    private async processCreditPayment(
        payment: any,
        paymentId: string,
        amountReceived: number
    ) {
        // Tính số credits dựa trên số tiền (1000 VND = 1 credit)
        const creditsToAdd = Math.floor(amountReceived / 1000);

        // Sử dụng transaction để đảm bảo tính nhất quán
        await this.prisma.$transaction(async (tx) => {
            // 1. Cập nhật payment status
            await tx.payment.update({
                where: { id: paymentId },
                data: {
                    status: PAYMENT_STATUS.PAID,
                    amount: amountReceived,
                    updatedBy: 'SEPAY_WEBHOOK',
                },
            });

            // 2. Cộng credits vào wallet
            const wallet = await this.walletRepository.findByUserId(
                payment.userId,
                false
            );

            if (wallet) {
                await tx.wallet.update({
                    where: { id: wallet.id },
                    data: {
                        balance: wallet.balance + creditsToAdd,
                        updatedBy: 'SEPAY_WEBHOOK',
                    },
                });

                // 3. Tạo wallet transaction
                await tx.walletTransaction.create({
                    data: {
                        id: this.generateIdService.generateId(),
                        walletId: wallet.id,
                        amount: creditsToAdd,
                        type: WALLET_TRANSACTION_TYPE.BUY_CREDITS,
                        direction: 'ADD',
                        description: `Nạp ${creditsToAdd} credits từ chuyển khoản ${amountReceived.toLocaleString('vi-VN')} VND`,
                        createdBy: 'SEPAY_WEBHOOK',
                    },
                });

                // Invalidate wallet cache
                await this.walletRepository.invalidateUserCache(payment.userId);
                // Invalidate wallet transaction stats cache
                await this.walletTransactionRepository.invalidateWalletCache(
                    wallet.id
                );
            }
        });

        this.logger.log(
            `Credit payment ${paymentId} processed: +${creditsToAdd} credits for user ${payment.userId}`
        );
    }

    /**
     * Xử lý thanh toán đăng ký subscription
     */
    private async processSubscriptionPayment(
        payment: any,
        paymentId: string,
        amountReceived: number
    ) {
        // Xác định tier và billing cycle từ số tiền
        const { tier, billingCycle } =
            getSubscriptionTierFromPrice(amountReceived);

        if (tier === SUBSCRIPTION_TIER.NONE) {
            this.logger.warn(
                `Cannot determine subscription tier from amount: ${amountReceived}`
            );
            // Fallback to credit payment
            return this.processCreditPayment(
                payment,
                paymentId,
                amountReceived
            );
        }

        // Cập nhật payment status
        await this.prisma.payment.update({
            where: { id: paymentId },
            data: {
                status: PAYMENT_STATUS.PAID,
                amount: amountReceived,
                updatedBy: 'SEPAY_WEBHOOK',
            },
        });

        // Kích hoạt subscription (bao gồm cả việc cộng credits hàng tháng)
        await this.subscriptionService.activateSubscription(
            payment.userId,
            tier,
            billingCycle
        );

        // Invalidate wallet cache
        await this.walletRepository.invalidateUserCache(payment.userId);

        const wallet = await this.walletRepository.findByUserId(
            payment.userId,
            false
        );
        if (wallet) {
            await this.walletTransactionRepository.invalidateWalletCache(
                wallet.id
            );
        }

        this.logger.log(
            `Subscription payment ${paymentId} processed: tier ${tier}, cycle ${billingCycle} for user ${payment.userId}`
        );
    }
}
