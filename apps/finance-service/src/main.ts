import { NestFactory } from '@nestjs/core';
import { Transport, MicroserviceOptions } from '@nestjs/microservices';
import { join } from 'path';
import { FinanceServiceModule } from './finance-service.module';

async function bootstrap() {
    // HTTP server
    const app = await NestFactory.create(FinanceServiceModule);

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
