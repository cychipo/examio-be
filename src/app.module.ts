import { Module } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { AuthModule } from './packages/auth/auth.module';
import { AIModule } from './packages/ai/ai.module';
import { FinanceModule } from './packages/finance/finance.module';
import { ExamModule } from './packages/exam/exam.module';
import { R2Module } from './packages/r2/r2.module';
import { RedisModule } from './packages/redis/redis.module';
import { VirtualTeacherModule } from './packages/virtual-teacher/virtual-teacher.module';

@Module({
    providers: [PrismaService],
    imports: [AuthModule, AIModule, FinanceModule, ExamModule, R2Module, RedisModule, VirtualTeacherModule],
})
export class AppModule {}
