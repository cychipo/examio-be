import { Module } from '@nestjs/common';
import { AIService } from './ai.service';
import { AIController } from './ai.controller';
import { GenerateIdService } from 'src/common/services/generate-id.service';
import { R2Service } from '../r2/r2.service';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from 'src/prisma/prisma.service';
import { RedisModule } from '../redis/redis.module';
import { PdfService } from 'src/common/services/pdf.service';

@Module({
    providers: [
        AIService,
        GenerateIdService,
        R2Service,
        PrismaService,
        PdfService,
    ],
    controllers: [AIController],
    exports: [AIService],
    imports: [AuthModule, RedisModule],
})
export class AIModule {}
