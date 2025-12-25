import { Controller, Get } from '@nestjs/common';
import { FinanceServiceService } from './finance-service.service';

@Controller()
export class FinanceServiceController {
  constructor(private readonly financeServiceService: FinanceServiceService) {}

  @Get()
  getHello(): string {
    return this.financeServiceService.getHello();
  }
}
