import { Module } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';
import { GenerateIdService } from 'src/common/services/generate-id.service';
import { AuthGuard } from 'src/common/guard/auth.guard';
import { AuthModule } from 'src/packages/auth/auth.module';
import { WalletRepository } from './wallet.repository';
import { WalletTransactionRepository } from './wallettransaction.repository';

@Module({
    imports: [AuthModule],
    providers: [
        PrismaService,
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
