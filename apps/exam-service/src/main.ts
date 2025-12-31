import { config } from 'dotenv';
import { join } from 'path';

// Load .env file from service directory
config({ path: join(process.cwd(), 'apps', 'exam-service', '.env') });

import { NestFactory } from '@nestjs/core';
import { ExamServiceModule } from './exam-service.module';

async function bootstrap() {
    const app = await NestFactory.create(ExamServiceModule);

    // Global prefix to match gateway proxy paths
    app.setGlobalPrefix('api/v1');

    // Enable CORS
    app.enableCors({
        origin: process.env.FRONTEND_URL || [
            'http://localhost:5173',
            'http://localhost:3001',
            'http://127.0.0.1:5173',
        ],
        credentials: true,
    });

    const port = process.env.PORT ?? 3002;
    await app.listen(port);
    console.log(`🚀 Exam Service is running on port ${port}`);
}
bootstrap();
