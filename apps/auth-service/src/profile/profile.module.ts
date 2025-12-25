import { Module } from '@nestjs/common';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import { AuthModule } from '../auth.module';
import { PrismaService } from 'src/prisma/prisma.service';
import { R2Module } from 'src/packages/r2/r2.module';
import { GenerateIdService } from 'src/common/services/generate-id.service';

@Module({
    imports: [AuthModule, R2Module],
    controllers: [ProfileController],
    providers: [ProfileService, PrismaService, GenerateIdService],
    exports: [ProfileService],
})
export class ProfileModule {}
