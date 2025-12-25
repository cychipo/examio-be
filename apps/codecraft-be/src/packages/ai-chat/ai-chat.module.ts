import { Module } from '@nestjs/common';
import { AIChatController } from './ai-chat.controller';
import { AIChatService } from './ai-chat.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { RedisModule } from '../redis/redis.module';
import { VirtualTeacherModule } from '../virtual-teacher/virtual-teacher.module';
import { GenerateIdService } from 'src/common/services/generate-id.service';
import { R2Module } from '../r2/r2.module';
import { AIModule } from '../ai/ai.module';
import { SePayModule } from '../finance/modules/sepay/sepay.module';

@Module({
    controllers: [AIChatController],
    providers: [AIChatService, PrismaService, GenerateIdService],
    exports: [AIChatService],
    imports: [
        AuthModule,
        RedisModule,
        VirtualTeacherModule,
        R2Module,
        AIModule,
        SePayModule,
    ],
})
export class AIChatModule {}
