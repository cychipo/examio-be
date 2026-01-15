import { Module } from '@nestjs/common';
import { StatisticsController } from './statistics.controller';
import { StatisticsService } from './statistics.service';
import { RedisModule } from '@examio/redis';
import { AuthModule } from '@examio/common';

@Module({
    imports: [RedisModule, AuthModule],
    controllers: [StatisticsController],
    providers: [StatisticsService],
    exports: [StatisticsService],
})
export class StatisticsModule {}
