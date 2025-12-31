import { Module } from '@nestjs/common';
import { ExamSessionService } from './examsession.service';
import { ExamSessionController } from './examsession.controller';
import { PrismaService } from '@examio/database';
import { GenerateIdService, AuthModule } from '@examio/common';
import { RedisService } from '@examio/redis';
import { ExamSessionRepository } from './examsession.repository';
import { ExamRoomRepository } from '../examroom/examroom.repository';

@Module({
    imports: [AuthModule],
    providers: [
        PrismaService,
        RedisService,
        ExamSessionService,
        GenerateIdService,
        ExamSessionRepository,
        ExamRoomRepository,
    ],
    controllers: [ExamSessionController],
    exports: [ExamSessionService, ExamSessionRepository],
})
export class ExamSessionModule {}
