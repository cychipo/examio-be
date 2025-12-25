import { Module } from '@nestjs/common';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import { PrismaService } from '@examio/database';
import { GenerateIdService, GrpcClientsModule } from '@examio/common';
import { UserRepository } from '../repositories/user.repository';
import { RedisService } from '@examio/redis';

@Module({
    imports: [GrpcClientsModule.registerR2Client()],
    controllers: [ProfileController],
    providers: [
        ProfileService,
        PrismaService,
        GenerateIdService,
        UserRepository,
        RedisService,
    ],
    exports: [ProfileService],
})
export class ProfileModule {}
