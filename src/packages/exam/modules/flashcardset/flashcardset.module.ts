import { Module } from '@nestjs/common';
import { FlashcardsetService } from './flashcardset.service';
import { FlashcardsetController } from './flashcardset.controller';
import { PrismaService } from 'src/prisma/prisma.service';
import { GenerateIdService } from 'src/common/services/generate-id.service';
import { AuthModule } from 'src/packages/auth/auth.module';
import { AuthGuard } from 'src/common/guard/auth.guard';
import { FlashCardSetRepository } from './flashcardset.repository';

@Module({
    imports: [AuthModule],
    providers: [
        PrismaService,
        FlashcardsetService,
        GenerateIdService,
        AuthGuard,
        FlashCardSetRepository,
    ],
    controllers: [FlashcardsetController],
    exports: [FlashcardsetService, FlashCardSetRepository],
})
export class FlashcardsetModule {}
