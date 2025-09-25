import { Module } from '@nestjs/common';
import { AIService } from './ai.service';
import { AIController } from './ai.controller';
import { GenerateIdService } from 'src/common/services/generate-id.service';

@Module({
    providers: [AIService, GenerateIdService],
    controllers: [AIController],
    exports: [AIService],
})
export class AIModule {}
