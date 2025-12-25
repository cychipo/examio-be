import { WalletModule } from './modules/wallet/wallet.module';
import { SePayModule } from './modules/sepay/sepay.module';
import { Module } from '@nestjs/common';

@Module({
    imports: [WalletModule, SePayModule],
    exports: [WalletModule, SePayModule],
})
export class FinanceModule {}
