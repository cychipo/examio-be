import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PrismaService } from '@examio/database';
import { GenerateIdService, AuthModule, EventsModule } from '@examio/common';
import { AIController } from './ai.controller';
import { AIService } from './ai.service';
import { AIRepository } from './ai.repository';

@Module({
    imports: [AuthModule, EventsModule, HttpModule],
    controllers: [AIController],
    providers: [AIService, AIRepository, PrismaService, GenerateIdService],
    exports: [AIService, AIRepository],
})
export class AIModule {}
