import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const frontendOrigin = process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173';
  if (process.env.NODE_ENV === 'production' && !frontendOrigin.startsWith('https://')) {
    throw new Error('FRONTEND_ORIGIN must use HTTPS in production');
  }
  app.setGlobalPrefix('api');
  app.use(helmet({ referrerPolicy: { policy: 'no-referrer' } }));
  app.useGlobalPipes(new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }));
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableCors({
    origin: frontendOrigin,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Owner-Token'],
    credentials: false,
  });
  const port = Number(process.env.API_PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  console.log(`SecureShare API listening on port ${port}`);
}
bootstrap();