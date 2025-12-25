import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { HttpModule } from '@nestjs/axios';

import { GatewayController } from './gateway.controller';
import { ProxyMiddleware } from './middleware/proxy.middleware';
import { AuthProxyController } from './controllers/auth-proxy.controller';
import { ExamProxyController } from './controllers/exam-proxy.controller';
import { FinanceProxyController } from './controllers/finance-proxy.controller';
import { ProxyService } from './services/proxy.service';

@Module({
    imports: [
        // Rate limiting: 100 requests per minute
        ThrottlerModule.forRoot([
            {
                ttl: 60000, // 1 minute
                limit: 100,
            },
        ]),
        HttpModule.register({
            timeout: 30000,
            maxRedirects: 5,
        }),
    ],
    controllers: [
        GatewayController,
        AuthProxyController,
        ExamProxyController,
        FinanceProxyController,
    ],
    providers: [
        {
            provide: APP_GUARD,
            useClass: ThrottlerGuard,
        },
        ProxyService,
    ],
})
export class GatewayModule implements NestModule {
    configure(consumer: MiddlewareConsumer) {
        // Apply proxy middleware to specific routes if needed
        // consumer.apply(ProxyMiddleware).forRoutes('*');
    }
}
