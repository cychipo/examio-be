import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { swaggerConfig } from './config/swagger.config';
import { SwaggerModule } from '@nestjs/swagger';

const whitelist = [
    process.env.FRONTEND_URL,
    'http://localhost:3001',
    'http://localhost:3002',
    'http://localhost:3000',
    'https://examio-api.fayedark.com',
].filter((u) => typeof u === 'string');

async function bootstrap() {
    const app = await NestFactory.create<NestExpressApplication>(AppModule);
    app.enableCors({
        origin: function (origin, callback) {
            // Check if the incoming request's 'origin' is in our whitelist
            if (whitelist.indexOf(origin) !== -1 || !origin) {
                // If it is, allow it by reflecting the origin
                callback(null, true);
            } else {
                // If it's not, block it
                callback(new Error('Not allowed by CORS'));
            }
        },
        methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
        credentials: true,
        allowedHeaders: [
            'Content-Type',
            'Authorization',
            'Cookie',
            'X-Requested-With',
        ],
        exposedHeaders: ['Set-Cookie'],
    });
    app.setGlobalPrefix('api/v1');
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api', app, document, {
        swaggerOptions: { persistAuthorization: true },
    });
    console.log(
        'Server is running on port:',
        process.env.PORT || 3000,
        `http://localhost:${process.env.PORT || 3000}/api`
    );
    await app.listen(process.env.PORT || 3000);
}
bootstrap();
