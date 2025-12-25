import { Module, DynamicModule } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { join } from 'path';

export const WALLET_SERVICE = 'WALLET_SERVICE';
export const R2_SERVICE = 'R2_SERVICE';

@Module({})
export class GrpcClientsModule {
    /**
     * Đăng ký gRPC client cho WalletService
     * Dùng trong Auth Service để gọi Finance Service
     */
    static registerWalletClient(): DynamicModule {
        return {
            module: GrpcClientsModule,
            imports: [
                ClientsModule.register([
                    {
                        name: WALLET_SERVICE,
                        transport: Transport.GRPC,
                        options: {
                            package: 'wallet',
                            protoPath: join(
                                __dirname,
                                '../protos/wallet.proto'
                            ),
                            url:
                                process.env.WALLET_GRPC_URL ||
                                'localhost:50053',
                        },
                    },
                ]),
            ],
            exports: [ClientsModule],
        };
    }

    /**
     * Đăng ký gRPC client cho R2Service
     * Dùng trong các service cần upload/download files
     */
    static registerR2Client(): DynamicModule {
        return {
            module: GrpcClientsModule,
            imports: [
                ClientsModule.register([
                    {
                        name: R2_SERVICE,
                        transport: Transport.GRPC,
                        options: {
                            package: 'r2',
                            protoPath: join(__dirname, '../protos/r2.proto'),
                            url: process.env.R2_GRPC_URL || 'localhost:50054',
                        },
                    },
                ]),
            ],
            exports: [ClientsModule],
        };
    }

    /**
     * Đăng ký tất cả gRPC clients
     */
    static registerAll(): DynamicModule {
        return {
            module: GrpcClientsModule,
            imports: [
                ClientsModule.register([
                    {
                        name: WALLET_SERVICE,
                        transport: Transport.GRPC,
                        options: {
                            package: 'wallet',
                            protoPath: join(
                                __dirname,
                                '../protos/wallet.proto'
                            ),
                            url:
                                process.env.WALLET_GRPC_URL ||
                                'localhost:50053',
                        },
                    },
                    {
                        name: R2_SERVICE,
                        transport: Transport.GRPC,
                        options: {
                            package: 'r2',
                            protoPath: join(__dirname, '../protos/r2.proto'),
                            url: process.env.R2_GRPC_URL || 'localhost:50054',
                        },
                    },
                ]),
            ],
            exports: [ClientsModule],
        };
    }
}
