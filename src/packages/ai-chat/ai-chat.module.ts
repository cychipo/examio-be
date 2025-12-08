import { Module } from '@nestjs/common';
import { AIChatController } from './ai-chat.controller';
import { AIChatService } from './ai-chat.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { RedisModule } from '../redis/redis.module';
import { VirtualTeacherModule } from '../virtual-teacher/virtual-teacher.module';

@Module({
    controllers: [AIChatController],
    providers: [AIChatService, PrismaService],
    exports: [AIChatService],
    imports: [AuthModule, RedisModule, VirtualTeacherModule],
})
export class AIChatModule {}
