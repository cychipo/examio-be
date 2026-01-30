import { config } from 'dotenv';
import { join } from 'path';

// Load .env file from service directory
config({ path: join(process.cwd(), 'apps', 'ocr-service', '.env') });

import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { OcrServiceModule } from './ocr-service.module';

async function bootstrap() {
    // Create gRPC microservice
    const app = await NestFactory.createMicroservice<MicroserviceOptions>(
        OcrServiceModule,
        {
            transport: Transport.GRPC,
            options: {
                package: 'ocr',
                protoPath: join(
                    __dirname,
                    '../../../libs/common/src/protos/ocr.proto',
                ),
                url: `0.0.0.0:${process.env.GRPC_PORT || '50053'}`,
            },
        },
    );

    await app.listen();

    console.log(
        `🚀 OCR Service gRPC running on port ${process.env.GRPC_PORT || '50053'}`,
    );
    console.log(
        `🐍 Python backend should be running on ${process.env.OCR_PYTHON_SERVICE_URL || 'http://127.0.0.1:8003'}`,
    );
}

bootstrap();
