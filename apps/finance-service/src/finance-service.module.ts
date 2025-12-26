import { Module } from '@nestjs/common';
import { DatabaseModule, PrismaService } from '@examio/database';
import { GenerateIdService, EventsModule } from '@examio/common';
import { RedisModule } from '@examio/redis';
import { FinanceServiceController } from './finance-service.controller';
import { FinanceServiceService } from './finance-service.service';
import { WalletGrpcController } from './modules/wallet/wallet.grpc.controller';
import { UserEventHandler } from './events/user-event.handler';
import { WalletModule } from './modules/wallet/wallet.module';
import { SePayModule } from './modules/sepay/sepay.module';

@Module({
    imports: [
        DatabaseModule,
        RedisModule,
        EventsModule,
        WalletModule,
        SePayModule,
    ],
    controllers: [FinanceServiceController, WalletGrpcController],
    providers: [
        FinanceServiceService,
        PrismaService,
        GenerateIdService,
        UserEventHandler,
    ],
})
export class FinanceServiceModule {}
