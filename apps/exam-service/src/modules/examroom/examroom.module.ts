import { Module } from '@nestjs/common';
import { ExamRoomService } from './examroom.service';
import { ExamRoomController } from './examroom.controller';
import { PrismaService } from '@examio/database';
import { GenerateIdService, AuthGuard } from '@examio/common';
import { RedisService } from '@examio/redis';
import { ExamRoomRepository } from './examroom.repository';
import { QuizSetRepository } from '../quizset/quizset.repository';

@Module({
    providers: [
        PrismaService,
        RedisService,
        ExamRoomService,
        GenerateIdService,
        AuthGuard,
        ExamRoomRepository,
        QuizSetRepository,
    ],
    controllers: [ExamRoomController],
    exports: [ExamRoomService, ExamRoomRepository],
})
export class ExamRoomModule {}
