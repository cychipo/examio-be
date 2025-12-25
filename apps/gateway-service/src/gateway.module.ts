import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { HttpModule } from '@nestjs/axios';

import { GatewayController } from './gateway.controller';
import { ProxyMiddleware } from './middleware/proxy.middleware';
import { ProxyService } from './services/proxy.service';

// Auth
import { AuthProxyController } from './controllers/auth-proxy.controller';

// Exam Service
import { QuizsetProxyController } from './controllers/quizset-proxy.controller';
import { FlashcardsetProxyController } from './controllers/flashcardset-proxy.controller';
import { ExamRoomProxyController } from './controllers/examroom-proxy.controller';
import { ExamSessionProxyController } from './controllers/examsession-proxy.controller';
import { ExamAttemptProxyController } from './controllers/examattempt-proxy.controller';

// Finance & Profile
import {
    WalletProxyController,
    PaymentProxyController,
    ProfileProxyController,
    DevicesProxyController,
} from './controllers/wallet-profile-proxy.controller';

// AI & Study
import {
    AIProxyController,
    AIChatProxyController,
    FlashcardStudyProxyController,
    QuizPracticeProxyController,
    CheatingLogProxyController,
} from './controllers/ai-study-proxy.controller';

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
        // Auth
        AuthProxyController,
        // Exam
        QuizsetProxyController,
        FlashcardsetProxyController,
        ExamRoomProxyController,
        ExamSessionProxyController,
        ExamAttemptProxyController,
        // Finance & Profile
        WalletProxyController,
        PaymentProxyController,
        ProfileProxyController,
        DevicesProxyController,
        // AI & Study
        AIProxyController,
        AIChatProxyController,
        FlashcardStudyProxyController,
        QuizPracticeProxyController,
        CheatingLogProxyController,
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
        consumer.apply(ProxyMiddleware).forRoutes('*');
    }
}
