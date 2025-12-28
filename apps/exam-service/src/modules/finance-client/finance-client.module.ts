import { Module, Global } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { join } from 'path';
import { FinanceClientService } from './finance-client.service';

@Global()
@Module({
    imports: [
        ClientsModule.register([
            {
                name: 'FINANCE_PACKAGE',
                transport: Transport.GRPC,
                options: {
                    package: ['wallet', 'subscription'],
                    protoPath: [
                        join(
                            process.cwd(),
                            'libs/common/src/protos/wallet.proto'
                        ),
                        join(
                            process.cwd(),
                            'libs/common/src/protos/subscription.proto'
                        ),
                    ],
                    url:
                        process.env.FINANCE_SERVICE_GRPC_URL || '0.0.0.0:50053',
                },
            },
        ]),
    ],
    providers: [FinanceClientService],
    exports: [ClientsModule, FinanceClientService],
})
export class FinanceClientModule {}
