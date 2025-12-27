import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AuthModule } from '@examio/common';
import { AIChatController } from './ai-chat.controller';
import { AIChatService } from './ai-chat.service';
import { AIChatRepository } from './ai-chat.repository';

@Module({
    imports: [HttpModule, AuthModule],
    controllers: [AIChatController],
    providers: [AIChatService, AIChatRepository],
    exports: [AIChatService],
})
export class AIChatModule {}
