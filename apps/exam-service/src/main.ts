import { NestFactory } from '@nestjs/core';
import { ExamServiceModule } from './exam-service.module';

async function bootstrap() {
    const app = await NestFactory.create(ExamServiceModule);
    await app.listen(process.env.port ?? 3002);
}
bootstrap();
