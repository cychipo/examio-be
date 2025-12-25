import { Module } from '@nestjs/common';
import { ExamServiceController } from './exam-service.controller';
import { ExamServiceService } from './exam-service.service';

@Module({
  imports: [],
  controllers: [ExamServiceController],
  providers: [ExamServiceService],
})
export class ExamServiceModule {}
