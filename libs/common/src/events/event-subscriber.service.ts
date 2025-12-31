import {
    Injectable,
    Logger,
    OnModuleInit,
    OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BaseEvent, EventType, EventChannels } from './event-types';
import { RabbitMQService } from './rabbitmq.service';
import { ChannelWrapper } from 'amqp-connection-manager';

export type EventHandler<T = any> = (event: BaseEvent<T>) => Promise<void>;

/**
 * EventSubscriberService - Subscribe và handle events từ RabbitMQ
 * Sử dụng trong các service để lắng nghe events
 */
@Injectable()
export class EventSubscriberService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(EventSubscriberService.name);
    private handlers: Map<EventType, EventHandler[]> = new Map();
    private channelWrapper: ChannelWrapper;
    private queueName: string;

    constructor(
        private readonly rabbitMQService: RabbitMQService,
        private readonly configService: ConfigService
    ) {
        this.queueName = this.configService.get<string>(
            'SERVICE_NAME',
            'common-queue'
        );
    }

    async onModuleInit() {
        this.channelWrapper = this.rabbitMQService.createChannel({
            json: true,
            setup: async (channel: any) => {
                // Ensure exchange exists
                await channel.assertExchange(EventChannels.EXCHANGE, 'topic', {
                    durable: true,
                });

                // Ensure queue exists
                await channel.assertQueue(this.queueName, {
                    durable: true,
                });

                // Consume from queue
                await channel.consume(this.queueName, async (msg: any) => {
                    if (msg !== null) {
                        const content = JSON.parse(msg.content.toString());
                        await this.handleMessage(content);
                        channel.ack(msg);
                    }
                });
            },
        });
    }

    async onModuleDestroy() {
        if (this.channelWrapper) {
            await this.channelWrapper.close();
        }
    }

    /**
     * Subscribe tới một routing key (binding queue tới exchange)
     */
    async subscribe(routingKey: string): Promise<void> {
        try {
            await this.channelWrapper.addSetup(async (channel: any) => {
                await channel.bindQueue(
                    this.queueName,
                    EventChannels.EXCHANGE,
                    routingKey
                );
                this.logger.log(
                    `Bound queue ${this.queueName} to exchange ${EventChannels.EXCHANGE} with key: ${routingKey}`
                );
            });
        } catch (error) {
            this.logger.error(
                `Failed to bind queue to ${routingKey}: ${error.message}`
            );
            throw error;
        }
    }

    /**
     * Subscribe tới Auth events (auth.*)
     */
    async subscribeToAuthEvents(): Promise<void> {
        return this.subscribe('auth.#');
    }

    /**
     * Subscribe tới Finance events (finance.*)
     */
    async subscribeToFinanceEvents(): Promise<void> {
        return this.subscribe('finance.#');
    }

    /**
     * Subscribe tới Exam events (exam.*)
     */
    async subscribeToExamEvents(): Promise<void> {
        return this.subscribe('exam.#');
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
     * Handle incoming event
     */
    private async handleMessage(event: BaseEvent): Promise<void> {
        try {
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
            this.logger.error(`Failed to process event: ${error.message}`);
        }
    }
}
