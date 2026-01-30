/**
 * FREE_MODE: Khi bật, tất cả người dùng đều có quyền truy cập không giới hạn
 * Đặt thành true để bỏ qua tất cả giới hạn thanh toán/subscription
 * Đặt thành false để bật lại hệ thống thanh toán
 */
export const FREE_MODE = true;

/**
 * Subscription Tier Constants
 */
export enum SUBSCRIPTION_TIER {
    NONE = 0,
    BASIC = 1,
    ADVANCED = 2,
    VIP = 3,
}

export type BillingCycle = 'monthly' | 'yearly';

/**
 * Subscription tier benefits configuration
 * Khi FREE_MODE = true, tier NONE sẽ có quyền tương đương VIP
 */
export const SUBSCRIPTION_BENEFITS = {
    [SUBSCRIPTION_TIER.NONE]: FREE_MODE
        ? {
              // FREE_MODE: Unlimited access
              name: 'Free',
              nameVi: 'Miễn phí',
              creditsPerMonth: 999999,
              filesPerMonth: -1, // unlimited
              messagesPerMinute: -1, // unlimited
              chatMessagesLimit: 999999,
              priceMonthly: 0,
              priceYearly: 0,
          }
        : {
              // Original limits (khi tắt FREE_MODE)
              name: 'Free',
              nameVi: 'Miễn phí',
              creditsPerMonth: 0,
              filesPerMonth: 5,
              messagesPerMinute: 5,
              chatMessagesLimit: 30,
              priceMonthly: 0,
              priceYearly: 0,
          },
    [SUBSCRIPTION_TIER.BASIC]: {
        name: 'Basic',
        nameVi: 'Cơ bản',
        creditsPerMonth: 50,
        filesPerMonth: 15,
        messagesPerMinute: 10,
        chatMessagesLimit: 70,
        priceMonthly: 60000, // 60k VND
        priceYearly: 648000, // 60k * 12 * 0.9 = 648k
    },
    [SUBSCRIPTION_TIER.ADVANCED]: {
        name: 'Advanced',
        nameVi: 'Nâng cao',
        creditsPerMonth: 100,
        filesPerMonth: 30,
        messagesPerMinute: 15,
        chatMessagesLimit: 100, // per user (200 total)
        priceMonthly: 120000, // 120k VND
        priceYearly: 1296000, // 120k * 12 * 0.9 = 1.296k
    },
    [SUBSCRIPTION_TIER.VIP]: {
        name: 'VIP',
        nameVi: 'VIP',
        creditsPerMonth: 500,
        filesPerMonth: -1, // unlimited
        messagesPerMinute: -1, // unlimited
        chatMessagesLimit: 200, // per user
        priceMonthly: 990000, // 990k VND
        priceYearly: 10692000, // 990k * 12 * 0.9 = 10.692k
    },
} as const;

/**
 * Credit pricing: 1000 VND = 1 credit
 */
export const CREDIT_PRICE_VND = 1000;

/**
 * Get subscription price based on tier and billing cycle
 */
export function getSubscriptionPrice(
    tier: SUBSCRIPTION_TIER,
    billingCycle: BillingCycle
): number {
    const benefits = SUBSCRIPTION_BENEFITS[tier];
    return billingCycle === 'yearly'
        ? benefits.priceYearly
        : benefits.priceMonthly;
}

/**
 * Calculate credits price in VND
 */
export function calculateCreditsPrice(credits: number): number {
    return credits * CREDIT_PRICE_VND;
}

/**
 * Determine subscription tier and billing cycle from payment amount
 * Used by webhook to identify which tier was purchased
 * Allows 5% tolerance for payment fees
 */
export function getSubscriptionTierFromPrice(amount: number): {
    tier: SUBSCRIPTION_TIER;
    billingCycle: BillingCycle;
} {
    const tolerance = 0.05; // 5% tolerance

    // Check each tier and billing cycle
    const tiers = [
        SUBSCRIPTION_TIER.VIP,
        SUBSCRIPTION_TIER.ADVANCED,
        SUBSCRIPTION_TIER.BASIC,
    ];

    for (const tier of tiers) {
        const benefits = SUBSCRIPTION_BENEFITS[tier];

        // Check yearly first (usually higher amount)
        if (
            amount >= benefits.priceYearly * (1 - tolerance) &&
            amount <= benefits.priceYearly * (1 + tolerance)
        ) {
            return { tier, billingCycle: 'yearly' };
        }

        // Check monthly
        if (
            amount >= benefits.priceMonthly * (1 - tolerance) &&
            amount <= benefits.priceMonthly * (1 + tolerance)
        ) {
            return { tier, billingCycle: 'monthly' };
        }
    }

    // If no match, return NONE
    return { tier: SUBSCRIPTION_TIER.NONE, billingCycle: 'monthly' };
}
