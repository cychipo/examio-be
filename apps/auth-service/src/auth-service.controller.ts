import { Controller, Get } from '@nestjs/common';
import { AuthServiceService } from './auth-service.service';

@Controller()
export class AuthServiceController {
  constructor(private readonly authServiceService: AuthServiceService) {}

  @Get('health')
  health() {
    return { status: 'ok', service: 'auth-service' };
  }

  @Get()
  getHello(): string {
    return this.authServiceService.getHello();
  }
}
