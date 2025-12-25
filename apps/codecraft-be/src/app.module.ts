import { Module } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { AuthModule } from './packages/auth/auth.module';
import { AIModule } from './packages/ai/ai.module';
import { FinanceModule } from './packages/finance/finance.module';
import { ExamModule } from './packages/exam/exam.module';
import { R2Module } from './packages/r2/r2.module';
import { RedisModule } from './packages/redis/redis.module';
import { VirtualTeacherModule } from './packages/virtual-teacher/virtual-teacher.module';
import { AIChatModule } from './packages/ai-chat/ai-chat.module';
import { ProfileModule } from './packages/auth/profile/profile.module';
import { DevicesModule } from './packages/devices/devices.module';
import { ThrottlerModule, ThrottlerGuard, minutes } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

@Module({
    providers: [
        PrismaService,
        {
            provide: APP_GUARD,
            useClass: ThrottlerGuard,
        },
    ],
    imports: [
        ThrottlerModule.forRoot([
            {
                ttl: minutes(1),
                limit: 50,
            },
        ]),
        AuthModule,
        AIModule,
        FinanceModule,
        ExamModule,
        R2Module,
        RedisModule,
        VirtualTeacherModule,
        AIChatModule,
        ProfileModule,
        DevicesModule,
    ],
})
export class AppModule {}
