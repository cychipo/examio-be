import { Module } from '@nestjs/common';
import { FlashcardsetService } from './flashcardset.service';
import { FlashcardsetController } from './flashcardset.controller';
import { PrismaService } from '@examio/database';
import {
    GenerateIdService,
    AuthGuard,
    GrpcClientsModule,
} from '@examio/common';
import { RedisService } from '@examio/redis';
import { FlashCardSetRepository } from './flashcardset.repository';

@Module({
    imports: [GrpcClientsModule.registerR2Client()],
    providers: [
        PrismaService,
        RedisService,
        FlashcardsetService,
        GenerateIdService,
        AuthGuard,
        FlashCardSetRepository,
    ],
    controllers: [FlashcardsetController],
    exports: [FlashcardsetService, FlashCardSetRepository],
})
export class FlashcardSetModule {}
