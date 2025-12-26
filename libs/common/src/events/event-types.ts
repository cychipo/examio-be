/**
 * Event Types - Các sự kiện trong hệ thống microservices
 */

export enum EventType {
    // Auth Events
    USER_CREATED = 'user.created',
    USER_UPDATED = 'user.updated',
    USER_DELETED = 'user.deleted',
    USER_VERIFIED = 'user.verified',

    // Finance Events
    PAYMENT_SUCCESS = 'payment.success',
    PAYMENT_FAILED = 'payment.failed',
    WALLET_CREATED = 'wallet.created',
    WALLET_UPDATED = 'wallet.updated',
    SUBSCRIPTION_ACTIVATED = 'subscription.activated',
    SUBSCRIPTION_EXPIRED = 'subscription.expired',

    // Exam Events
    EXAM_CREATED = 'exam.created',
    EXAM_STARTED = 'exam.started',
    EXAM_SUBMITTED = 'exam.submitted',

    // AI/OCR Events
    OCR_REQUESTED = 'ocr.requested',
    OCR_COMPLETED = 'ocr.completed',
    OCR_FAILED = 'ocr.failed',
}

/**
 * Event Channels - Redis Pub/Sub channels
 */
export const EventChannels = {
    AUTH: 'examio:events:auth',
    FINANCE: 'examio:events:finance',
    EXAM: 'examio:events:exam',
    ALL: 'examio:events:*',
    EXCHANGE: 'examio.events',
} as const;

/**
 * Base Event Interface
 */
export interface BaseEvent<T = any> {
    type: EventType;
    timestamp: number;
    payload: T;
    metadata?: {
        correlationId?: string;
        sourceService?: string;
    };
}

// ==================== Event Payloads ====================

export interface UserCreatedPayload {
    userId: string;
    email: string;
    username?: string;
}

export interface UserDeletedPayload {
    userId: string;
}

export interface PaymentSuccessPayload {
    paymentId: string;
    userId: string;
    amount: number;
    paymentType: 'credits' | 'subscription';
}

export interface WalletCreatedPayload {
    walletId: string;
    userId: string;
    initialBalance: number;
}

export interface SubscriptionActivatedPayload {
    userId: string;
    tier: number;
    billingCycle: 'monthly' | 'yearly';
    expiresAt: number;
}

export interface OcrRequestedPayload {
    userStorageId: string;
    userId: string;
    fileUrl: string;
    fileName: string;
    mimeType: string;
}

export interface OcrCompletedPayload {
    userStorageId: string;
    userId: string;
    chunksCount: number;
}

export interface OcrFailedPayload {
    userStorageId: string;
    userId: string;
    error: string;
}
