import { Module } from '@nestjs/common';
import { DatabaseModule, PrismaService } from '@examio/database';
import { GenerateIdService } from '@examio/common';
import { FinanceServiceController } from './finance-service.controller';
import { FinanceServiceService } from './finance-service.service';
import { WalletGrpcController } from './modules/wallet/wallet.grpc.controller';

@Module({
    imports: [DatabaseModule],
    controllers: [FinanceServiceController, WalletGrpcController],
    providers: [FinanceServiceService, PrismaService, GenerateIdService],
})
export class FinanceServiceModule {}
