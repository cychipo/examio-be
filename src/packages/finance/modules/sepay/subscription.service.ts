import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { GenerateIdService } from 'src/common/services/generate-id.service';
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
}
