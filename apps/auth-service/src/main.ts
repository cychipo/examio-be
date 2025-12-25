import { NestFactory } from '@nestjs/core';
import { AuthServiceModule } from './auth-service.module';

async function bootstrap() {
    const app = await NestFactory.create(AuthServiceModule);
    await app.listen(process.env.port ?? 3001);
}
bootstrap();
