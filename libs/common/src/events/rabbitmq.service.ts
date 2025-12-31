import {
    Injectable,
    OnModuleInit,
    OnModuleDestroy,
    Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqp-connection-manager';
import { AmqpConnectionManager } from 'amqp-connection-manager';

@Injectable()
export class RabbitMQService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(RabbitMQService.name);
    private connection: AmqpConnectionManager;

    constructor(private readonly configService: ConfigService) {}

    async onModuleInit() {
        const rabbitUrls = [
            this.configService.get<string>(
                'RABBITMQ_URL',
                'amqp://localhost:5672'
            ),
        ];

        this.connection = amqp.connect(rabbitUrls);

        this.connection.on('connect', () => {
            this.logger.log('Successfully connected to RabbitMQ');
        });

        this.connection.on('disconnect', ({ err }) => {
            this.logger.error('Disconnected from RabbitMQ', err?.stack);
        });
    }

    async onModuleDestroy() {
        if (this.connection) {
            await this.connection.close();
        }
    }

    getConnection(): AmqpConnectionManager {
        return this.connection;
    }

    createChannel(options: any) {
        return this.connection.createChannel(options);
    }
}
