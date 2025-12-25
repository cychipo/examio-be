import { Module, Global } from '@nestjs/common';
import { RedisModule } from '@examio/redis';
import { EventPublisherService } from './event-publisher.service';
import { EventSubscriberService } from './event-subscriber.service';

/**
 * EventsModule - Module cung cấp event publishing/subscribing
 * Import module này trong các service cần gửi/nhận events
 */
@Global()
@Module({
    imports: [RedisModule],
    providers: [EventPublisherService, EventSubscriberService],
    exports: [EventPublisherService, EventSubscriberService],
})
export class EventsModule {}
