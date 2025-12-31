import { config } from 'dotenv';
import { join } from 'path';

// Load .env file from service directory
config({ path: join(process.cwd(), 'apps', 'auth-service', '.env') });

import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AuthServiceModule } from './auth-service.module';

async function bootstrap() {
    // Create HTTP application
    const app = await NestFactory.create(AuthServiceModule);

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

    // Connect gRPC microservice
    const grpcPort = process.env.GRPC_PORT || '50051';
    app.connectMicroservice<MicroserviceOptions>({
        transport: Transport.GRPC,
        options: {
            package: 'auth',
            protoPath: join(
                __dirname,
                '../../../libs/common/src/protos/auth.proto'
            ),
            url: `0.0.0.0:${grpcPort}`,
        },
    });

    // Start all microservices
    await app.startAllMicroservices();

    // Start HTTP server
    const httpPort = process.env.PORT || 3001;
    await app.listen(httpPort);

    console.log(`🚀 Auth Service HTTP running on port ${httpPort}`);
    console.log(`🔌 Auth Service gRPC running on port ${grpcPort}`);
}
bootstrap();
