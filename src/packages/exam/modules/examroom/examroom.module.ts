import { Module } from '@nestjs/common';
import { ExamRoomService } from './examroom.service';
import { ExamRoomController } from './examroom.controller';
import { PrismaService } from 'src/prisma/prisma.service';
import { GenerateIdService } from 'src/common/services/generate-id.service';
import { AuthModule } from 'src/packages/auth/auth.module';
import { AuthGuard } from 'src/common/guard/auth.guard';

@Module({
    imports: [AuthModule],
    providers: [PrismaService, ExamRoomService, GenerateIdService, AuthGuard],
    controllers: [ExamRoomController],
    exports: [ExamRoomService],
})
export class ExamRoomModule {}
