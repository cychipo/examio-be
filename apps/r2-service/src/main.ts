import { config } from 'dotenv';
import { join } from 'path';

// Load .env file from service directory
config({ path: join(process.cwd(), 'apps', 'r2-service', '.env') });

import { NestFactory } from '@nestjs/core';
import { Transport, MicroserviceOptions } from '@nestjs/microservices';
import { R2ServiceModule } from './r2-service.module';

async function bootstrap() {
    // HTTP server for health checks
    const app = await NestFactory.create(R2ServiceModule);

    // Use absolute path from process.cwd() for proto file
    const protoPath = join(
        process.cwd(),
        'libs',
        'common',
        'src',
        'protos',
        'r2.proto'
    );
    console.log(`📄 Using proto file: ${protoPath}`);

    // gRPC microservice
    app.connectMicroservice<MicroserviceOptions>({
        transport: Transport.GRPC,
        options: {
            package: 'r2',
            protoPath,
            url: `0.0.0.0:${process.env.GRPC_PORT || 50054}`,
        },
    });

    await app.startAllMicroservices();
    await app.listen(process.env.PORT ?? 3004);

    console.log(`🚀 R2 Service is running on port ${process.env.PORT ?? 3004}`);
    console.log(
        `📡 gRPC server is running on port ${process.env.GRPC_PORT || 50054}`
    );
}
bootstrap();
