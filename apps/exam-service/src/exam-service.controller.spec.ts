import { Test, TestingModule } from '@nestjs/testing';
import { ExamServiceController } from './exam-service.controller';
import { ExamServiceService } from './exam-service.service';

describe('ExamServiceController', () => {
  let examServiceController: ExamServiceController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [ExamServiceController],
      providers: [ExamServiceService],
    }).compile();

    examServiceController = app.get<ExamServiceController>(ExamServiceController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(examServiceController.getHello()).toBe('Hello World!');
    });
  });
});
