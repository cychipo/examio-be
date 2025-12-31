import { Injectable } from '@nestjs/common';

@Injectable()
export class FinanceServiceService {
  getHello(): string {
    return 'Hello World!';
  }
}
