import {
    Injectable,
    Logger,
    OnModuleInit,
    OnModuleDestroy,
} from '@nestjs/common';
import { RedisService } from '@examio/redis';
import { BaseEvent, EventType, EventChannels } from './event-types';

export type EventHandler<T = any> = (event: BaseEvent<T>) => Promise<void>;

/**
 * EventSubscriberService - Subscribe và handle events từ Redis Pub/Sub
 * Sử dụng trong các service để lắng nghe events
 */
@Injectable()
export class EventSubscriberService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(EventSubscriberService.name);
    private handlers: Map<EventType, EventHandler[]> = new Map();
    private subscribedChannels: Set<string> = new Set();

    constructor(private readonly redis: RedisService) {}

    async onModuleInit() {
        // Đăng ký sẵn các channels cần thiết
        // Việc subscribe sẽ được gọi từ service khi cần
    }

    async onModuleDestroy() {
        // Cleanup subscriptions
        for (const channel of this.subscribedChannels) {
            try {
                await this.redis.unsubscribe(channel);
                this.logger.log(`Unsubscribed from channel: ${channel}`);
            } catch (error) {
                this.logger.error(
                    `Failed to unsubscribe from ${channel}: ${error.message}`
                );
            }
        }
    }

    /**
     * Subscribe tới một channel và handle messages
     */
    async subscribe(channel: string): Promise<void> {
        if (this.subscribedChannels.has(channel)) {
            return;
        }

        try {
            await this.redis.subscribe(channel, async (message: string) => {
                await this.handleMessage(message);
            });

            this.subscribedChannels.add(channel);
            this.logger.log(`Subscribed to channel: ${channel}`);
        } catch (error) {
            this.logger.error(
                `Failed to subscribe to ${channel}: ${error.message}`
            );
            throw error;
        }
    }

    /**
     * Subscribe tới Auth events channel
     */
    async subscribeToAuthEvents(): Promise<void> {
        return this.subscribe(EventChannels.AUTH);
    }

    /**
     * Subscribe tới Finance events channel
     */
    async subscribeToFinanceEvents(): Promise<void> {
        return this.subscribe(EventChannels.FINANCE);
    }

    /**
     * Subscribe tới Exam events channel
     */
    async subscribeToExamEvents(): Promise<void> {
        return this.subscribe(EventChannels.EXAM);
    }

    /**
     * Đăng ký handler cho một event type
     */
    on<T = any>(eventType: EventType, handler: EventHandler<T>): void {
        const existingHandlers = this.handlers.get(eventType) || [];
        existingHandlers.push(handler as EventHandler);
        this.handlers.set(eventType, existingHandlers);
        this.logger.debug(`Registered handler for event: ${eventType}`);
    }

    /**
     * Hủy đăng ký handler
     */
    off(eventType: EventType, handler: EventHandler): void {
        const existingHandlers = this.handlers.get(eventType) || [];
        const index = existingHandlers.indexOf(handler);
        if (index > -1) {
            existingHandlers.splice(index, 1);
            this.handlers.set(eventType, existingHandlers);
        }
    }

    /**
     * Handle incoming message
     */
    private async handleMessage(message: string): Promise<void> {
        try {
            const event: BaseEvent = JSON.parse(message);
            const handlers = this.handlers.get(event.type) || [];

            if (handlers.length === 0) {
                this.logger.debug(`No handlers for event: ${event.type}`);
                return;
            }

            this.logger.log(
                `Processing event ${event.type} [${event.metadata?.correlationId}]`
            );

            // Execute all handlers
            await Promise.all(
                handlers.map(async (handler) => {
                    try {
                        await handler(event);
                    } catch (error) {
                        this.logger.error(
                            `Handler error for ${event.type}: ${error.message}`
                        );
                    }
                })
            );
        } catch (error) {
            this.logger.error(
                `Failed to parse event message: ${error.message}`
            );
        }
    }
}
