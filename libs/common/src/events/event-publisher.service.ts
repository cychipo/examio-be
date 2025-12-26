import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { BaseEvent, EventType, EventChannels } from './event-types';
import { RabbitMQService } from './rabbitmq.service';
import { ChannelWrapper } from 'amqp-connection-manager';

/**
 * EventPublisherService - Publish events tới RabbitMQ
 * Sử dụng trong các service để broadcast events
 */
@Injectable()
export class EventPublisherService implements OnModuleInit {
    private readonly logger = new Logger(EventPublisherService.name);
    private channelWrapper: ChannelWrapper;

    constructor(private readonly rabbitMQService: RabbitMQService) {}

    async onModuleInit() {
        this.channelWrapper = this.rabbitMQService.createChannel({
            json: true,
            setup: (channel: any) => {
                return channel.assertExchange(EventChannels.EXCHANGE, 'topic', {
                    durable: true,
                });
            },
        });
    }

    /**
     * Publish event tới RabbitMQ Exchange với routing key tương ứng
     * Routing key format: service.event_type
     */
    async publish<T>(
        routingKey: string,
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
            await this.channelWrapper.publish(
                EventChannels.EXCHANGE,
                routingKey,
                event
            );
            this.logger.log(
                `Published event ${type} with routing key ${routingKey} [${event.metadata?.correlationId}]`
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
        return this.publish(`auth.${type}`, type, payload, {
            sourceService: 'auth-service',
        });
    }

    /**
     * Publish Finance event (payment.success, wallet.created, etc.)
     */
    async publishFinanceEvent<T>(type: EventType, payload: T): Promise<void> {
        return this.publish(`finance.${type}`, type, payload, {
            sourceService: 'finance-service',
        });
    }

    /**
     * Publish Exam event (exam.created, exam.submitted, etc.)
     */
    async publishExamEvent<T>(type: EventType, payload: T): Promise<void> {
        return this.publish(`exam.${type}`, type, payload, {
            sourceService: 'exam-service',
        });
    }

    private generateCorrelationId(): string {
        return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    }
}
