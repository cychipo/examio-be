import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@examio/database';
import { GenerateIdService } from '@examio/common';
import {
    SUBSCRIPTION_TIER,
    BillingCycle,
    SUBSCRIPTION_BENEFITS,
} from '../../types/subscription';
import { WalletRepository } from '../wallet/wallet.repository';
import { WALLET_TRANSACTION_TYPE } from '../wallet/dto/wallet-details-response.dto';

@Injectable()
export class SubscriptionService {
    private readonly logger = new Logger(SubscriptionService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly generateIdService: GenerateIdService,
        private readonly walletRepository: WalletRepository
    ) {}

    /**
     * Get user's current subscription
     */
    async getSubscription(userId: string) {
        const subscription = await this.prisma.userSubscription.findUnique({
            where: { userId },
        });

        if (!subscription) {
            return {
                tier: SUBSCRIPTION_TIER.NONE,
                tierName: 'Free',
                isActive: false,
                benefits: SUBSCRIPTION_BENEFITS[SUBSCRIPTION_TIER.NONE],
                nextPaymentDate: null,
            };
        }

        const tierName =
            subscription.tier === SUBSCRIPTION_TIER.BASIC
                ? 'Cơ bản'
                : subscription.tier === SUBSCRIPTION_TIER.ADVANCED
                  ? 'Nâng cao'
                  : subscription.tier === SUBSCRIPTION_TIER.VIP
                    ? 'VIP'
                    : 'Free';

        return {
            id: subscription.id,
            tier: subscription.tier,
            tierName,
            billingCycle: subscription.billingCycle,
            isActive: subscription.isActive,
            benefits:
                SUBSCRIPTION_BENEFITS[subscription.tier as SUBSCRIPTION_TIER] ||
                SUBSCRIPTION_BENEFITS[SUBSCRIPTION_TIER.NONE],
            lastPaymentDate: subscription.lastPaymentDate,
            nextPaymentDate: subscription.nextPaymentDate,
        };
    }

    /**
     * Activate or upgrade subscription after successful payment
     * Called from webhook after payment confirmation
     */
    async activateSubscription(
        userId: string,
        tier: SUBSCRIPTION_TIER,
        billingCycle: BillingCycle
    ) {
        const now = new Date();
        const nextPaymentDate = new Date(now);

        if (billingCycle === 'yearly') {
            nextPaymentDate.setFullYear(nextPaymentDate.getFullYear() + 1);
        } else {
            nextPaymentDate.setMonth(nextPaymentDate.getMonth() + 1);
        }

        // Upsert subscription
        const subscription = await this.prisma.userSubscription.upsert({
            where: { userId },
            update: {
                tier,
                billingCycle,
                isActive: true,
                lastPaymentDate: now,
                nextPaymentDate,
                updatedBy: 'SYSTEM',
            },
            create: {
                id: this.generateIdService.generateId(),
                userId,
                tier,
                billingCycle,
                isActive: true,
                lastPaymentDate: now,
                nextPaymentDate,
                createdBy: 'SYSTEM',
            },
        });

        // Add credits to wallet based on billing cycle
        const benefits = SUBSCRIPTION_BENEFITS[tier];
        if (benefits.creditsPerMonth > 0) {
            const creditsToAdd =
                billingCycle === 'yearly'
                    ? benefits.creditsPerMonth * 12
                    : benefits.creditsPerMonth;
            await this.addSubscriptionCredits(userId, creditsToAdd);
        }

        this.logger.log(
            `Subscription activated for user ${userId}: tier ${tier}, cycle ${billingCycle}`
        );

        return subscription;
    }

    /**
     * Add monthly subscription credits to wallet
     */
    private async addSubscriptionCredits(userId: string, credits: number) {
        const wallet = await this.walletRepository.findByUserId(userId, false);

        if (!wallet) {
            await this.prisma.$transaction(async (tx) => {
                const id = this.generateIdService.generateId();
                await tx.wallet.create({
                    data: {
                        id,
                        userId,
                        balance: credits,
                        createdBy: 'SUBSCRIPTION',
                    },
                });

                // Create transaction record
                await tx.walletTransaction.create({
                    data: {
                        id: this.generateIdService.generateId(),
                        walletId: id,
                        amount: credits,
                        type: WALLET_TRANSACTION_TYPE.BUY_SUBSCRIPTION,
                        direction: 'ADD',
                        description: `Credits hàng tháng từ gói đăng ký (+${credits} credits)`,
                        createdBy: 'SUBSCRIPTION',
                    },
                });
            });
        } else {
            await this.prisma.$transaction(async (tx) => {
                // Update wallet balance
                await tx.wallet.update({
                    where: { id: wallet.id },
                    data: {
                        balance: wallet.balance + credits,
                        updatedBy: 'SUBSCRIPTION',
                    },
                });

                // Create transaction record
                await tx.walletTransaction.create({
                    data: {
                        id: this.generateIdService.generateId(),
                        walletId: wallet.id,
                        amount: credits,
                        type: WALLET_TRANSACTION_TYPE.BUY_SUBSCRIPTION,
                        direction: 'ADD',
                        description: `Credits hàng tháng từ gói đăng ký (+${credits} credits)`,
                        createdBy: 'SUBSCRIPTION',
                    },
                });
            });
        }

        // Invalidate wallet cache
        await this.walletRepository.invalidateUserCache(userId);

        this.logger.log(
            `Added ${credits} subscription credits to user ${userId}`
        );
    }

    /**
     * Check if user has active subscription
     */
    async hasActiveSubscription(userId: string): Promise<boolean> {
        const subscription = await this.prisma.userSubscription.findUnique({
            where: { userId },
        });

        if (!subscription) return false;

        // Check if subscription is active and not expired
        if (!subscription.isActive) return false;

        if (
            subscription.nextPaymentDate &&
            subscription.nextPaymentDate < new Date()
        ) {
            // Subscription expired
            await this.prisma.userSubscription.update({
                where: { userId },
                data: { isActive: false },
            });
            return false;
        }

        return true;
    }

    /**
     * Get subscription benefits for a tier
     */
    getSubscriptionBenefits(tier: SUBSCRIPTION_TIER) {
        return (
            SUBSCRIPTION_BENEFITS[tier] ||
            SUBSCRIPTION_BENEFITS[SUBSCRIPTION_TIER.NONE]
        );
    }

    /**
     * Get all subscription plans for display
     */
    getAllPlans() {
        return [
            {
                tier: SUBSCRIPTION_TIER.BASIC,
                ...SUBSCRIPTION_BENEFITS[SUBSCRIPTION_TIER.BASIC],
            },
            {
                tier: SUBSCRIPTION_TIER.ADVANCED,
                ...SUBSCRIPTION_BENEFITS[SUBSCRIPTION_TIER.ADVANCED],
            },
            {
                tier: SUBSCRIPTION_TIER.VIP,
                ...SUBSCRIPTION_BENEFITS[SUBSCRIPTION_TIER.VIP],
            },
        ];
    }

    // ==================== SUBSCRIPTION LIMITS ====================

    /**
     * Get user's subscription benefits based on their current tier
     * Returns FREE tier benefits if no active subscription
     */
    async getUserSubscriptionBenefits(userId: string) {
        const subscription = await this.prisma.userSubscription.findUnique({
            where: { userId },
        });

        // Check if subscription is active
        if (
            !subscription ||
            !subscription.isActive ||
            (subscription.nextPaymentDate &&
                subscription.nextPaymentDate < new Date())
        ) {
            return SUBSCRIPTION_BENEFITS[SUBSCRIPTION_TIER.NONE];
        }

        return (
            SUBSCRIPTION_BENEFITS[subscription.tier as SUBSCRIPTION_TIER] ||
            SUBSCRIPTION_BENEFITS[SUBSCRIPTION_TIER.NONE]
        );
    }

    /**
     * Get current month's file upload count for user
     */
    async getMonthlyFileUploadCount(userId: string): Promise<number> {
        const yearMonth = this.getCurrentYearMonth();
        const record = await this.prisma.userMonthlyFileUpload.findUnique({
            where: { userId_yearMonth: { userId, yearMonth } },
        });
        return record?.count ?? 0;
    }

    /**
     * Increment file upload count for current month
     * Uses upsert to handle both new and existing records
     */
    async incrementFileUploadCount(userId: string): Promise<void> {
        const yearMonth = this.getCurrentYearMonth();
        await this.prisma.userMonthlyFileUpload.upsert({
            where: { userId_yearMonth: { userId, yearMonth } },
            create: {
                userId,
                yearMonth,
                count: 1,
            },
            update: {
                count: { increment: 1 },
            },
        });
    }

    /**
     * Check if user has exceeded their monthly file upload limit
     * Throws BadRequestException if limit exceeded
     * @param userId - User ID to check
     * @throws BadRequestException if limit exceeded
     */
    async checkFileUploadLimit(userId: string): Promise<void> {
        const benefits = await this.getUserSubscriptionBenefits(userId);
        const limit = benefits.filesPerMonth;

        // -1 means unlimited
        if (limit === -1) return;

        const currentCount = await this.getMonthlyFileUploadCount(userId);
        if (currentCount >= limit) {
            const subscription = await this.getSubscription(userId);
            throw new BadRequestException(
                `Bạn đã đạt giới hạn ${limit} file/tháng của gói ${subscription.tierName}. Vui lòng nâng cấp gói để tải thêm file.`
            );
        }
    }

    /**
     * Get current year-month string in format "YYYY-MM"
     */
    private getCurrentYearMonth(): string {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        return `${year}-${month}`;
    }
}
