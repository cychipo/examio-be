import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';
import { AuthModule } from './packages/auth/auth.module';

@Module({
    controllers: [AppController],
    providers: [AppService, PrismaService],
    imports: [AuthModule],
})
export class AppModule {}
