import { Test, TestingModule } from '@nestjs/testing';
import { R2ServiceController } from './r2-service.controller';
import { R2ServiceService } from './r2-service.service';

describe('R2ServiceController', () => {
  let r2ServiceController: R2ServiceController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [R2ServiceController],
      providers: [R2ServiceService],
    }).compile();

    r2ServiceController = app.get<R2ServiceController>(R2ServiceController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(r2ServiceController.getHello()).toBe('Hello World!');
    });
  });
});
