import {
    Injectable,
    NotFoundException,
    BadRequestException,
    Logger,
    ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { User } from '@prisma/client';
import { GenerateIdService } from 'src/common/services/generate-id.service';
import { SePayService } from './sepay.service';
import { PAYMENT_STATUS } from '../../types/payment';
import {
    SUBSCRIPTION_TIER,
    BillingCycle,
    getSubscriptionPrice,
    calculateCreditsPrice,
} from '../../types/subscription';

export interface CreatePaymentDto {
    type: 'credits' | 'subscription';
    credits?: number; // Required if type is 'credits'
    subscriptionTier?: SUBSCRIPTION_TIER; // Required if type is 'subscription'
    billingCycle?: BillingCycle; // Required if type is 'subscription'
}

export interface PaymentWithQR {
    paymentId: string;
    amount: number;
    qrUrl: string;
    bankInfo: {
        bankName: string;
        accountNumber: string;
        accountName: string;
    };
}

@Injectable()
export class PaymentService {
    private readonly logger = new Logger(PaymentService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly generateIdService: GenerateIdService,
        private readonly sePayService: SePayService
    ) {}

    /**
     * Create a new payment and generate QR code
     * - If existing unpaid payment with same type exists:
     *   - If expired or different amount: update amount and reset expiry
     *   - If same amount and not expired: reuse
     * - Otherwise: create new payment
     */
    async createPayment(
        user: User,
        dto: CreatePaymentDto
    ): Promise<PaymentWithQR> {
        try {
            let amount: number;
            let description: string;
            const paymentType = dto.type;
            const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

            if (dto.type === 'credits') {
                if (!dto.credits || dto.credits < 10 || dto.credits > 5000) {
                    throw new BadRequestException(
                        'Số credits phải từ 10 đến 5000'
                    );
                }
                amount = calculateCreditsPrice(dto.credits);
                description = `Mua ${dto.credits} credits`;
            } else if (dto.type === 'subscription') {
                if (dto.subscriptionTier === undefined) {
                    throw new BadRequestException(
                        'Vui lòng chọn gói đăng ký hợp lệ'
                    );
                }
                if (dto.subscriptionTier === SUBSCRIPTION_TIER.NONE) {
                    throw new BadRequestException(
                        'Vui lòng chọn gói đăng ký hợp lệ'
                    );
                }
                const billingCycle = dto.billingCycle || 'monthly';
                amount = getSubscriptionPrice(
                    dto.subscriptionTier,
                    billingCycle
                );
                const tierName =
                    dto.subscriptionTier === SUBSCRIPTION_TIER.BASIC
                        ? 'Cơ bản'
                        : dto.subscriptionTier === SUBSCRIPTION_TIER.ADVANCED
                          ? 'Nâng cao'
                          : 'VIP';
                description = `Đăng ký gói ${tierName} (${billingCycle === 'yearly' ? 'năm' : 'tháng'})`;
            } else {
                throw new BadRequestException('Loại thanh toán không hợp lệ');
            }

            // Check for existing unpaid payment with same type (any amount)
            const existingPayment = await this.prisma.payment.findFirst({
                where: {
                    userId: user.id,
                    paymentType,
                    status: PAYMENT_STATUS.UNPAID,
                },
                orderBy: { createdAt: 'desc' },
            });

            let paymentId: string;

            if (existingPayment) {
                // Treat null expiresAt (legacy) as expired
                const isExpired =
                    !existingPayment.expiresAt ||
                    new Date() > existingPayment.expiresAt;
                const isSameAmount = existingPayment.amount === amount;

                if (isExpired || !isSameAmount) {
                    // Update existing payment with new amount and reset expiry
                    await this.prisma.payment.update({
                        where: { id: existingPayment.id },
                        data: {
                            amount,
                            expiresAt,
                            updatedBy: user.id,
                        },
                    });
                    paymentId = existingPayment.id;
                    this.logger.log(
                        `Payment updated: ${paymentId} - ${amount.toLocaleString('vi-VN')} VND (${isExpired ? 'expired' : 'amount changed'})`
                    );
                } else {
                    // Reuse existing unpaid payment (same amount, not expired)
                    paymentId = existingPayment.id;
                    this.logger.log(
                        `Reusing existing payment: ${paymentId} - ${amount.toLocaleString('vi-VN')} VND`
                    );
                }
            } else {
                // Create new payment record
                paymentId = this.generateIdService.generateId();

                await this.prisma.payment.create({
                    data: {
                        id: paymentId,
                        userId: user.id,
                        amount,
                        currency: 'VND',
                        status: PAYMENT_STATUS.UNPAID,
                        paymentType,
                        expiresAt,
                        createdBy: user.id,
                    },
                });

                this.logger.log(
                    `Payment created: ${paymentId} - ${amount.toLocaleString('vi-VN')} VND for ${description}`
                );
            }

            // Generate QR code via SePay
            const qrResult = await this.sePayService.createQR(
                amount,
                paymentId
            );

            return {
                paymentId,
                amount,
                qrUrl: qrResult.QR,
                bankInfo: qrResult.bank,
            };
        } catch (error) {
            console.log('error create payment', error);
            this.logger.error(
                `Failed to create payment for user ${user.id}: ${error.message}`,
                error.stack
            );
            throw error;
        }
    }

    /**
     * Cancel a payment (delete record)
     */
    async cancelPayment(paymentId: string, userId: string): Promise<void> {
        const payment = await this.prisma.payment.findUnique({
            where: { id: paymentId },
        });

        if (!payment) {
            throw new NotFoundException('Không tìm thấy thanh toán');
        }

        if (payment.userId !== userId) {
            throw new ForbiddenException(
                'Bạn không có quyền hủy thanh toán này'
            );
        }

        if (payment.status !== PAYMENT_STATUS.UNPAID) {
            throw new BadRequestException('Chỉ có thể hủy thanh toán đang chờ');
        }

        // Delete payment record
        await this.prisma.payment.delete({
            where: { id: paymentId },
        });

        this.logger.log(`Payment cancelled by user: ${paymentId}`);
    }

    /**
     * Get payment status
     */
    async getPaymentStatus(paymentId: string, userId: string) {
        const payment = await this.prisma.payment.findUnique({
            where: { id: paymentId },
        });

        if (!payment) {
            throw new NotFoundException('Không tìm thấy thanh toán');
        }

        if (payment.userId !== userId) {
            throw new NotFoundException('Không tìm thấy thanh toán');
        }

        return {
            id: payment.id,
            amount: payment.amount,
            status: payment.status,
            statusLabel: this.getStatusLabel(payment.status),
            createdAt: payment.createdAt,
        };
    }

    /**
     * Get user's payment history
     */
    async getPaymentHistory(userId: string, page = 1, size = 10) {
        const skip = (page - 1) * size;

        const [payments, total] = await Promise.all([
            this.prisma.payment.findMany({
                where: { userId },
                orderBy: { createdAt: 'desc' },
                skip,
                take: size,
            }),
            this.prisma.payment.count({ where: { userId } }),
        ]);

        return {
            data: payments.map((p) => ({
                id: p.id,
                amount: p.amount,
                status: p.status,
                statusLabel: this.getStatusLabel(p.status),
                createdAt: p.createdAt,
            })),
            total,
            page,
            size,
            totalPages: Math.ceil(total / size),
        };
    }

    private getStatusLabel(status: number): string {
        switch (status) {
            case PAYMENT_STATUS.UNPAID:
                return 'Chờ thanh toán';
            case PAYMENT_STATUS.PAID:
                return 'Đã thanh toán';
            case PAYMENT_STATUS.OVERDUE:
                return 'Quá hạn';
            case PAYMENT_STATUS.CANCELED:
                return 'Đã hủy';
            default:
                return 'Không xác định';
        }
    }
}
