import { NestFactory } from '@nestjs/core';
import { FinanceServiceModule } from './finance-service.module';

async function bootstrap() {
    const app = await NestFactory.create(FinanceServiceModule);
    await app.listen(process.env.port ?? 3003);
}
bootstrap();
