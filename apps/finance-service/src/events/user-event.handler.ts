import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@examio/database';
import {
    EventSubscriberService,
    EventType,
    BaseEvent,
    UserCreatedPayload,
    GenerateIdService,
} from '@examio/common';

/**
 * UserEventHandler - Handle events liên quan đến User
 * Subscribe USER_CREATED để tạo wallet tự động
 */
@Injectable()
export class UserEventHandler implements OnModuleInit {
    private readonly logger = new Logger(UserEventHandler.name);

    constructor(
        private readonly eventSubscriber: EventSubscriberService,
        private readonly prisma: PrismaService,
        private readonly generateIdService: GenerateIdService
    ) {}

    async onModuleInit() {
        // Subscribe to auth events channel
        await this.eventSubscriber.subscribeToAuthEvents();

        // Register handler for USER_CREATED
        this.eventSubscriber.on<UserCreatedPayload>(
            EventType.USER_CREATED,
            this.handleUserCreated.bind(this)
        );

        this.logger.log('Subscribed to USER_CREATED events');
    }

    /**
     * Handle USER_CREATED event - tạo wallet cho user mới
     * Event được publish từ auth-service qua RabbitMQ
     */
    private async handleUserCreated(
        event: BaseEvent<UserCreatedPayload>
    ): Promise<void> {
        const { userId, email } = event.payload;

        try {
            // Idempotency check - wallet might already exist
            const existingWallet = await this.prisma.wallet.findUnique({
                where: { userId },
            });

            if (existingWallet) {
                this.logger.debug(
                    `Wallet already exists for user ${userId}, skipping`
                );
                return;
            }

            // Create wallet
            const wallet = await this.prisma.wallet.create({
                data: {
                    id: this.generateIdService.generateId(),
                    userId,
                    balance: 20, // Initial balance
                    createdBy: 'EVENT_HANDLER',
                },
            });

            // Create initial transaction
            await this.prisma.walletTransaction.create({
                data: {
                    id: this.generateIdService.generateId(),
                    walletId: wallet.id,
                    amount: 20,
                    type: 1, // INITIAL_CREDIT
                    direction: 'ADD',
                    description: 'Welcome bonus credits',
                    createdBy: 'EVENT_HANDLER',
                },
            });

            this.logger.log(
                `Created wallet ${wallet.id} for user ${userId} (${email}) via event`
            );
        } catch (error) {
            this.logger.error(
                `Failed to create wallet for user ${userId}: ${error.message}`
            );
        }
    }
}
