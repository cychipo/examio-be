import { Injectable } from '@nestjs/common';

@Injectable()
export class ExamServiceService {
  getHello(): string {
    return 'Hello World!';
  }
}
