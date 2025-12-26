import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventPublisherService } from './event-publisher.service';
import { EventSubscriberService } from './event-subscriber.service';
import { RabbitMQService } from './rabbitmq.service';

/**
 * EventsModule - Module cung cấp event publishing/subscribing
 * Import module này trong các service cần gửi/nhận events
 */
@Global()
@Module({
    imports: [ConfigModule],
    providers: [RabbitMQService, EventPublisherService, EventSubscriberService],
    exports: [RabbitMQService, EventPublisherService, EventSubscriberService],
})
export class EventsModule {}
