import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { HttpModule } from '@nestjs/axios';
import { AuthModule } from '@examio/common';

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
import { SubjectProxyController } from './controllers/subject-proxy.controller';

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

// R2 Storage
import { R2ProxyController } from './controllers/r2-proxy.controller';

// Webhook (external callbacks)
import { WebhookProxyController } from './controllers/webhook-proxy.controller';
import { StatisticsProxyController } from './controllers/statistics-proxy.controller';
import { StudentProxyController } from './controllers/student-proxy.controller';

@Module({
    imports: [
        AuthModule,
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
        SubjectProxyController,
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
        // R2 Storage
        R2ProxyController,
        // Webhook (external callbacks)
        WebhookProxyController,
        // Statistics
        StatisticsProxyController,
        // Student
        StudentProxyController,
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
