import { Module } from '@nestjs/common';
import { ParticipantService } from './participant.service';
import { ParticipantController } from './participant.controller';
import { PrismaService } from 'src/prisma/prisma.service';
import { GenerateIdService } from 'src/common/services/generate-id.service';
import { AuthModule } from 'src/packages/auth/auth.module';
import { AuthGuard } from 'src/common/guard/auth.guard';

@Module({
    imports: [AuthModule],
    providers: [
        PrismaService,
        ParticipantService,
        GenerateIdService,
        AuthGuard,
    ],
    controllers: [ParticipantController],
    exports: [ParticipantService],
})
export class ParticipantModule {}
