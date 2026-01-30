import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { OcrGrpcController } from './api/ocr.grpc.controller';
import { OcrService } from './services/ocr.service';

@Module({
    imports: [
        HttpModule.register({
            timeout: 300000, // 5 minutes
            maxRedirects: 5,
            // No file size limits - handle large PDFs
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
        }),
    ],
    controllers: [OcrGrpcController],
    providers: [OcrService],
    exports: [OcrService],
})
export class OcrServiceModule {}
