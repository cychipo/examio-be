import { Module } from '@nestjs/common';
import { FinanceServiceController } from './finance-service.controller';
import { FinanceServiceService } from './finance-service.service';

@Module({
  imports: [],
  controllers: [FinanceServiceController],
  providers: [FinanceServiceService],
})
export class FinanceServiceModule {}
