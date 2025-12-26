import { Module } from '@nestjs/common';
import { PrismaService } from '@examio/database';
import { GenerateIdService, AuthGuard, EventsModule } from '@examio/common';
import { AIController } from './ai.controller';
import { AIService } from './ai.service';
import { AIRepository } from './ai.repository';

@Module({
    imports: [EventsModule],
    controllers: [AIController],
    providers: [
        AIService,
        AIRepository,
        PrismaService,
        GenerateIdService,
        AuthGuard,
    ],
    exports: [AIService, AIRepository],
})
export class AIModule {}
