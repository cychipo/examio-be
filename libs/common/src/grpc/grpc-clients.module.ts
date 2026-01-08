import { Module, DynamicModule } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { join } from 'path';

export const WALLET_SERVICE = 'WALLET_SERVICE';
export const R2_SERVICE = 'R2_SERVICE';
export const AUTH_SERVICE = 'AUTH_SERVICE';

// Max message size for gRPC - 50MB for file uploads
const MAX_MESSAGE_SIZE = 500 * 1024 * 1024;

// Use project root + relative path to protos directory
// This works correctly with webpack bundling
const getProtoPath = (protoName: string) =>
    join(process.cwd(), 'libs', 'common', 'src', 'protos', protoName);

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
                            protoPath: getProtoPath('wallet.proto'),
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
                            protoPath: getProtoPath('r2.proto'),
                            url: process.env.R2_GRPC_URL || 'localhost:50054',
                            maxReceiveMessageLength: MAX_MESSAGE_SIZE,
                            maxSendMessageLength: MAX_MESSAGE_SIZE,
                        },
                    },
                ]),
            ],
            exports: [ClientsModule],
        };
    }

    /**
     * Đăng ký gRPC client cho AuthService
     * Dùng trong Exam/Finance Service để validate JWT
     */
    static registerAuthClient(): DynamicModule {
        return {
            module: GrpcClientsModule,
            imports: [
                ClientsModule.register([
                    {
                        name: AUTH_SERVICE,
                        transport: Transport.GRPC,
                        options: {
                            package: 'auth',
                            protoPath: getProtoPath('auth.proto'),
                            url: process.env.AUTH_GRPC_URL || 'localhost:50051',
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
                        name: AUTH_SERVICE,
                        transport: Transport.GRPC,
                        options: {
                            package: 'auth',
                            protoPath: getProtoPath('auth.proto'),
                            url: process.env.AUTH_GRPC_URL || 'localhost:50051',
                        },
                    },
                    {
                        name: WALLET_SERVICE,
                        transport: Transport.GRPC,
                        options: {
                            package: 'wallet',
                            protoPath: getProtoPath('wallet.proto'),
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
                            protoPath: getProtoPath('r2.proto'),
                            url: process.env.R2_GRPC_URL || 'localhost:50054',
                            maxReceiveMessageLength: MAX_MESSAGE_SIZE,
                            maxSendMessageLength: MAX_MESSAGE_SIZE,
                        },
                    },
                ]),
            ],
            exports: [ClientsModule],
        };
    }
}
