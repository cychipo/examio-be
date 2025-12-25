import { Module } from '@nestjs/common';
import { VirtualTeacherController } from './virtual-teacher.controller';
import { VirtualTeacherService } from './virtual-teacher.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { AIModule } from '../ai/ai.module';

@Module({
    controllers: [VirtualTeacherController],
    providers: [VirtualTeacherService, PrismaService],
    exports: [VirtualTeacherService],
    imports: [AuthModule, AIModule],
})
export class VirtualTeacherModule {}
