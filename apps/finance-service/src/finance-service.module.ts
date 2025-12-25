import { Module } from '@nestjs/common';
import { DatabaseModule, PrismaService } from '@examio/database';
import { GenerateIdService, EventsModule } from '@examio/common';
import { RedisModule } from '@examio/redis';
import { FinanceServiceController } from './finance-service.controller';
import { FinanceServiceService } from './finance-service.service';
import { WalletGrpcController } from './modules/wallet/wallet.grpc.controller';
import { UserEventHandler } from './events/user-event.handler';

@Module({
    imports: [DatabaseModule, RedisModule, EventsModule],
    controllers: [FinanceServiceController, WalletGrpcController],
    providers: [
        FinanceServiceService,
        PrismaService,
        GenerateIdService,
        UserEventHandler,
    ],
})
export class FinanceServiceModule {}
