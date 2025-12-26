import { Module } from '@nestjs/common';
import { PrismaService } from '@examio/database';
import { GenerateIdService, AuthModule, EventsModule } from '@examio/common';
import { AIController } from './ai.controller';
import { AIService } from './ai.service';
import { AIRepository } from './ai.repository';

@Module({
    imports: [AuthModule, EventsModule],
    controllers: [AIController],
    providers: [AIService, AIRepository, PrismaService, GenerateIdService],
    exports: [AIService, AIRepository],
})
export class AIModule {}
