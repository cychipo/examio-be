import { Module } from '@nestjs/common';
import { AuthServiceController } from './auth-service.controller';
import { AuthServiceService } from './auth-service.service';
import { AuthGrpcController } from './grpc/auth.grpc.controller';
import { DatabaseModule } from '@examio/database';
import { AuthModule } from './auth.module';

@Module({
    imports: [DatabaseModule, AuthModule],
    controllers: [AuthServiceController, AuthGrpcController],
    providers: [AuthServiceService],
})
export class AuthServiceModule {}
