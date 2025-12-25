import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@examio/redis';
import { BaseEvent, EventType, EventChannels } from './event-types';

/**
 * EventPublisherService - Publish events tới Redis Pub/Sub
 * Sử dụng trong các service để broadcast events
 */
@Injectable()
export class EventPublisherService {
    private readonly logger = new Logger(EventPublisherService.name);

    constructor(private readonly redis: RedisService) {}

    /**
     * Publish event tới channel tương ứng
     */
    async publish<T>(
        channel: string,
        type: EventType,
        payload: T,
        metadata?: { correlationId?: string; sourceService?: string }
    ): Promise<void> {
        const event: BaseEvent<T> = {
            type,
            timestamp: Date.now(),
            payload,
            metadata: {
                correlationId:
                    metadata?.correlationId || this.generateCorrelationId(),
                sourceService: metadata?.sourceService,
            },
        };

        try {
            await this.redis.publish(channel, JSON.stringify(event));
            this.logger.log(
                `Published event ${type} to ${channel} [${event.metadata?.correlationId}]`
            );
        } catch (error) {
            this.logger.error(
                `Failed to publish event ${type}: ${error.message}`
            );
            throw error;
        }
    }

    /**
     * Publish Auth event (user.created, user.deleted, etc.)
     */
    async publishAuthEvent<T>(type: EventType, payload: T): Promise<void> {
        return this.publish(EventChannels.AUTH, type, payload, {
            sourceService: 'auth-service',
        });
    }

    /**
     * Publish Finance event (payment.success, wallet.created, etc.)
     */
    async publishFinanceEvent<T>(type: EventType, payload: T): Promise<void> {
        return this.publish(EventChannels.FINANCE, type, payload, {
            sourceService: 'finance-service',
        });
    }

    /**
     * Publish Exam event (exam.created, exam.submitted, etc.)
     */
    async publishExamEvent<T>(type: EventType, payload: T): Promise<void> {
        return this.publish(EventChannels.EXAM, type, payload, {
            sourceService: 'exam-service',
        });
    }

    private generateCorrelationId(): string {
        return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    }
}
