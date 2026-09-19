import { swaggerOptions } from '@ambrosia/nest-auth';
import { JwtVerifier, swaggerProtection } from '@ambrosia/nest-auth';
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
  const verifier = app.get(JwtVerifier);
  app.use(swaggerProtection(verifier));
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('inventory-service')
      .setVersion('1.0.0')
      .addCookieAuth(
        'ambrosia_access',
        { type: 'apiKey', in: 'cookie' },
        'cookieAuth',
      )
      .addBearerAuth(undefined, 'bearerAuth')
      .addServer('..')
      .setDescription(
        'Catálogo interno v1: categorías y artículos. Lectura: inventory.read; mutaciones: inventory.write. Cookies requieren X-CSRF-Token y Origin autorizado; Bearer exclusivo no requiere CSRF. expectedVersion protege PATCH, archive y restore. Decimales como strings; capacidad nominal no implica peso neto.',
      )
      .build(),
  );
  document.security = [{ cookieAuth: [] }, { bearerAuth: [] }];
  for (const path of ['/api/v1/health/live', '/api/v1/health/ready']) {
    const operation = document.paths[path]?.get;
    if (operation) operation.security = [];
  }
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions,
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
