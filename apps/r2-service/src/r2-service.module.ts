import { Module } from '@nestjs/common';
import { R2ServiceController } from './r2-service.controller';
import { R2ServiceService } from './r2-service.service';

@Module({
  imports: [],
  controllers: [R2ServiceController],
  providers: [R2ServiceService],
})
export class R2ServiceModule {}
