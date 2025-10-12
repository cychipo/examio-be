import { WalletModule } from './modules/wallet/wallet.module';
import { Module } from '@nestjs/common';

@Module({
    imports: [WalletModule],
    exports: [WalletModule],
})
export class FinanceModule {}
