import { DocumentBuilder } from '@nestjs/swagger';

export const swaggerConfig = new DocumentBuilder()
    .setTitle('EXAMIO API')
    .setDescription('API documentation')
    .setVersion('v0.0.1')
    .addCookieAuth(
        'token',
        {
            type: 'apiKey',
            in: 'cookie',
            name: 'token',
            description: 'JWT token stored in cookie (auto-set after login)',
        },
        'cookie-auth'
    )
    .build();
