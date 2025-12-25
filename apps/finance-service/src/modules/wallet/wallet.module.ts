import { Module } from '@nestjs/common';
import { PrismaService } from '@examio/database';
import { GenerateIdService, AuthGuard } from '@examio/common';
import { RedisService } from '@examio/redis';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';
import { WalletRepository } from './wallet.repository';
import { WalletTransactionRepository } from './wallettransaction.repository';

@Module({
    providers: [
        PrismaService,
        RedisService,
        WalletService,
        GenerateIdService,
        AuthGuard,
        WalletRepository,
        WalletTransactionRepository,
    ],
    controllers: [WalletController],
    exports: [WalletService, WalletRepository, WalletTransactionRepository],
})
export class WalletModule {}
