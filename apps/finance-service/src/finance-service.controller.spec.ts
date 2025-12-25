import { Test, TestingModule } from '@nestjs/testing';
import { FinanceServiceController } from './finance-service.controller';
import { FinanceServiceService } from './finance-service.service';

describe('FinanceServiceController', () => {
  let financeServiceController: FinanceServiceController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [FinanceServiceController],
      providers: [FinanceServiceService],
    }).compile();

    financeServiceController = app.get<FinanceServiceController>(FinanceServiceController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(financeServiceController.getHello()).toBe('Hello World!');
    });
  });
});
