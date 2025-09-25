import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';
import { AuthModule } from './packages/auth/auth.module';
import { AIModule } from './packages/ai/ai.module';

@Module({
    controllers: [AppController],
    providers: [AppService, PrismaService],
    imports: [AuthModule, AIModule],
})
export class AppModule {}
