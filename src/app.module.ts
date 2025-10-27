import { Module } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { AuthModule } from './packages/auth/auth.module';
import { AIModule } from './packages/ai/ai.module';
import { FinanceModule } from './packages/finance/finance.module';
import { ExamModule } from './packages/exam/exam.module';
import { R2Module } from './packages/r2/r2.module';

@Module({
    providers: [PrismaService],
    imports: [AuthModule, AIModule, FinanceModule, ExamModule, R2Module],
})
export class AppModule {}
