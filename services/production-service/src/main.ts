import 'reflect-metadata';
import { ConsoleLogger, ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { correlation, SafeExceptionFilter } from './http';
async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: new ConsoleLogger({ json: true }),
  });
  const config = app.get(ConfigService);
  const levels = ['error', 'warn', 'log', 'debug', 'verbose'] as const;
  app.useLogger(
    levels.slice(0, levels.indexOf(config.getOrThrow('LOG_LEVEL')) + 1),
  );
  app.use(helmet());
  app.use(correlation);
  app.enableCors({
    origin: config.getOrThrow<string[]>('CORS_ALLOWED_ORIGINS'),
  });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(new SafeExceptionFilter());
  app.enableShutdownHooks();
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('production-service')
      .setVersion('1.0.0')
      .addServer('..')
      .setDescription(
        'Fundación técnica de Ambrosia. Liveness del proceso y readiness de PostgreSQL y NATS JetStream.',
      )
      .build(),
  );
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { url: '../docs-json' },
  });
  await app.listen(config.getOrThrow<number>('PORT'), '0.0.0.0');
}
void bootstrap().catch(() => {
  process.stderr.write(
    JSON.stringify({
      level: 'error',
      message:
        'No se pudo iniciar el servicio. Revisar configuración y puerto.',
    }) + '\n',
  );
  process.exitCode = 1;
});
