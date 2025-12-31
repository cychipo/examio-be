import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PrismaService } from '@examio/database';
import {
    GenerateIdService,
    AuthModule,
    EventsModule,
    GrpcClientsModule,
    R2ClientService,
} from '@examio/common';
import { AIController } from './ai.controller';
import { AIService } from './ai.service';
import { AIRepository } from './ai.repository';

@Module({
    imports: [
        AuthModule,
        EventsModule,
        HttpModule,
        GrpcClientsModule.registerR2Client(),
    ],
    controllers: [AIController],
    providers: [
        AIService,
        AIRepository,
        PrismaService,
        GenerateIdService,
        R2ClientService,
    ],
    exports: [AIService, AIRepository],
})
export class AIModule {}
