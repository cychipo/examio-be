import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AuthModule } from '@examio/common';
import { AIChatController } from './ai-chat.controller';
import { AIChatService } from './ai-chat.service';
import { AIChatRepository } from './ai-chat.repository';
import { R2Module } from '../r2/r2.module';

import { ClientsModule, Transport } from '@nestjs/microservices';
import { join } from 'path';

@Module({
    imports: [
        HttpModule,
        AuthModule,
        R2Module,
        ClientsModule.register([
            {
                name: 'FINANCE_PACKAGE',
                transport: Transport.GRPC,
                options: {
                    package: 'subscription',
                    protoPath: join(
                        process.cwd(),
                        'libs/common/src/protos/subscription.proto'
                    ),
                    url:
                        process.env.FINANCE_SERVICE_GRPC_URL || '0.0.0.0:50053',
                },
            },
        ]),
    ],
    controllers: [AIChatController],
    providers: [AIChatService, AIChatRepository],
    exports: [AIChatService],
})
export class AIChatModule {}
