import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { swaggerConfig } from './config/swagger.config';
import { SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
    const app = await NestFactory.create<NestExpressApplication>(AppModule);
    app.enableCors({
        origin: [
            process.env.FRONTEND_URL,
            'http://localhost:3001',
            'http://localhost:3002',
        ].join(','),
        methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
        credentials: true,
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
