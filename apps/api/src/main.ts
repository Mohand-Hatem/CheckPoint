import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { corsOptions } from './auth/auth-transport';
import { setupSwagger, swaggerEnabled } from './swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const logger = app.get(Logger);
  app.useLogger(logger);

  app.setGlobalPrefix('api');
  app.enableCors(corsOptions());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  if (swaggerEnabled()) {
    setupSwagger(app);
  }

  const port = process.env.PORT || 4000;
  await app.listen(port);
  logger.log(`🚀 CheckPoint API is running on: http://localhost:${port}/api`, 'Bootstrap');
  if (swaggerEnabled()) {
    logger.log(`📘 API docs: http://localhost:${port}/api/docs  (OpenAPI JSON: /api/docs-json)`, 'Bootstrap');
  }
}

bootstrap();
