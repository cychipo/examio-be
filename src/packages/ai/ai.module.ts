import { Module } from '@nestjs/common';
import { AIService } from './ai.service';
import { AIController } from './ai.controller';
import { GenerateIdService } from 'src/common/services/generate-id.service';
import { R2Service } from '../r2/r2.service';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from 'src/prisma/prisma.service';

@Module({
    providers: [AIService, GenerateIdService, R2Service, PrismaService],
    controllers: [AIController],
    exports: [AIService],
    imports: [AuthModule],
})
export class AIModule {}
