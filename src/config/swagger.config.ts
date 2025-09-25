import { DocumentBuilder } from '@nestjs/swagger';

export const swaggerConfig = new DocumentBuilder()
    .setTitle('EXAMIO API')
    .setDescription('API documentation')
    .setVersion('v0.0.1')
    .addBearerAuth(
        {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            name: 'Authorization',
            in: 'header',
            description: 'Enter your JWT token in the format: Bearer <token>',
        },
        'JWT'
    )
    .build();
