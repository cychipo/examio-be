import { Controller, Get } from '@nestjs/common';
import { ExamServiceService } from './exam-service.service';

@Controller()
export class ExamServiceController {
  constructor(private readonly examServiceService: ExamServiceService) {}

  @Get('health')
  health() {
    return { status: 'ok', service: 'exam-service' };
  }

  @Get()
  getHello(): string {
    return this.examServiceService.getHello();
  }
}
