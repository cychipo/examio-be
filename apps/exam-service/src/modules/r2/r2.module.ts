import { Module } from '@nestjs/common';
import { R2Controller } from './r2.controller';
import { R2UploadService } from './r2-upload.service';
import { AuthModule, GrpcClientsModule, R2ClientService } from '@examio/common';

@Module({
    imports: [AuthModule, GrpcClientsModule.registerR2Client()],
    controllers: [R2Controller],
    providers: [R2UploadService, R2ClientService],
    exports: [R2UploadService],
})
export class R2Module {}
