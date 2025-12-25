import { Module } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { SePayService } from './sepay.service';
import { WebhookService } from './webhook.service';
import { WebhookController } from './webhook.controller';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { SubscriptionService } from './subscription.service';
import { PaymentRepository } from './payment.repository';
import { WalletModule } from '../wallet/wallet.module';
import { GenerateIdService } from 'src/common/services/generate-id.service';
import { AuthModule } from 'src/packages/auth/auth.module';

@Module({
    imports: [WalletModule, AuthModule],
    providers: [
        PrismaService,
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
