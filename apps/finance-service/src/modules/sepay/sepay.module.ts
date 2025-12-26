import { Module } from '@nestjs/common';
import { PrismaService } from '@examio/database';
import { GenerateIdService, AuthModule } from '@examio/common';
import { RedisService } from '@examio/redis';
import { SePayService } from './sepay.service';
import { WebhookService } from './webhook.service';
import { WebhookController } from './webhook.controller';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { SubscriptionService } from './subscription.service';
import { PaymentRepository } from './payment.repository';
import { WalletModule } from '../wallet/wallet.module';

@Module({
    imports: [WalletModule, AuthModule],
    providers: [
        PrismaService,
        RedisService,
        SePayService,
        WebhookService,
        PaymentService,
        SubscriptionService,
        PaymentRepository,
        GenerateIdService,
    ],
    controllers: [WebhookController, PaymentController],
    exports: [
        SePayService,
        WebhookService,
        PaymentService,
        SubscriptionService,
        PaymentRepository,
    ],
})
export class SePayModule {}
