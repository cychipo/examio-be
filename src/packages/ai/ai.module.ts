import { Module } from '@nestjs/common';
import { AIService } from './ai.service';
import { AIController } from './ai.controller';
import { GenerateIdService } from 'src/common/services/generate-id.service';
import { R2Service } from '../r2/r2.service';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from 'src/prisma/prisma.service';
import { RedisModule } from '../redis/redis.module';
import { PdfService } from 'src/common/services/pdf.service';
import { ImagePreprocessingService } from 'src/common/services/image-preprocessing.service';
import { SePayModule } from '../finance/modules/sepay/sepay.module';

@Module({
    providers: [
        AIService,
        GenerateIdService,
        R2Service,
        PrismaService,
        ImagePreprocessingService,
        PdfService,
    ],
    controllers: [AIController],
    exports: [AIService],
    imports: [AuthModule, RedisModule, SePayModule],
})
export class AIModule {}
