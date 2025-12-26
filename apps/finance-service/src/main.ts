import { config } from 'dotenv';
import { join } from 'path';

// Load .env file from service directory
config({ path: join(process.cwd(), 'apps', 'finance-service', '.env') });

import { NestFactory } from '@nestjs/core';
import { Transport, MicroserviceOptions } from '@nestjs/microservices';
import { FinanceServiceModule } from './finance-service.module';

async function bootstrap() {
    // HTTP server
    const app = await NestFactory.create(FinanceServiceModule);

    // Global prefix to match gateway proxy paths
    app.setGlobalPrefix('api/v1');

    // Enable CORS
    app.enableCors({
        origin: process.env.FRONTEND_URL || [
            'http://localhost:5173',
            'http://localhost:3001',
            'http://127.0.0.1:5173',
        ],
        credentials: true,
    });

    // gRPC microservice for WalletService
    app.connectMicroservice<MicroserviceOptions>({
        transport: Transport.GRPC,
        options: {
            package: 'wallet',
            protoPath: join(
                __dirname,
                '../../../libs/common/src/protos/wallet.proto'
            ),
            url: `0.0.0.0:${process.env.GRPC_PORT || 50053}`,
        },
    });

    await app.startAllMicroservices();
    await app.listen(process.env.PORT ?? 3003);

    console.log(
        `🚀 Finance Service is running on port ${process.env.PORT ?? 3003}`
    );
    console.log(
        `📡 gRPC server is running on port ${process.env.GRPC_PORT || 50053}`
    );
}
bootstrap();
