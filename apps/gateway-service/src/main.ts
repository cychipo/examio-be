import { config } from 'dotenv';
import { join } from 'path';

// Load .env file from service directory
config({ path: join(process.cwd(), 'apps', 'gateway-service', '.env') });

import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { GatewayModule } from './gateway.module';
import * as cookieParser from 'cookie-parser';

async function bootstrap() {
    const app = await NestFactory.create(GatewayModule);

    // Cookie parser
    app.use(cookieParser());

    // Global prefix
    app.setGlobalPrefix('api/v1');

    // CORS
    app.enableCors({
        origin: process.env.FRONTEND_URL || [
            'http://localhost:5173',
            'http://localhost:3001',
            'http://127.0.0.1:5173',
        ],
        credentials: true,
        allowedHeaders: [
            'Content-Type',
            'Authorization',
            'Cookie',
            'X-Requested-With',
            'X-Device-ID',
        ],
    });

    // Swagger Configuration
    const config = new DocumentBuilder()
        .setTitle('ExamIO API')
        .setDescription(
            `
## ExamIO - Nền tảng Học tập Trực tuyến

### Các Service:
- **Auth**: Đăng ký, đăng nhập, OAuth
- **Exam**: Quiz, Flashcard, Phòng thi
- **Finance**: Wallet, Thanh toán, Subscription

### Authentication:
Sử dụng JWT Bearer token hoặc Cookie-based auth.
        `
        )
        .setVersion('1.0')
        .addBearerAuth(
            {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT',
            },
            'access-token'
        )
        .addCookieAuth('accessToken')
        .addTag('Auth', 'Authentication & User Management')
        .addTag('Exam', 'Quiz, Flashcard, Exam Room')
        .addTag('Finance', 'Wallet, Payment, Subscription')
        .addTag('Gateway', 'Health Check & Status')
        .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api', app, document, {
        customSiteTitle: 'ExamIO API Documentation',
        customCss: '.swagger-ui .topbar { display: none }',
        swaggerOptions: {
            persistAuthorization: true,
            tagsSorter: 'alpha',
            operationsSorter: 'alpha',
        },
    });

    const port = process.env.PORT || 3000;
    await app.listen(port);

    console.log(`🚀 Gateway running on http://localhost:${port}`);
    console.log(`📚 Swagger docs: http://localhost:${port}/api`);
}
bootstrap();
