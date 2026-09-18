import { swaggerOptions } from '@ambrosia/nest-auth';
import {
  JwtVerifier,
  authOptions,
  swaggerProtection,
} from '@ambrosia/nest-auth';
import 'reflect-metadata';
import {
  ConsoleLogger,
  ValidationPipe,
  VersioningType,
  RequestMethod,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { correlation, SafeExceptionFilter } from './common/http';
async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: new ConsoleLogger({ json: true }),
    bodyParser: false,
  });
  const config = app.get(ConfigService);
  const levels = ['error', 'warn', 'log', 'debug', 'verbose'] as const;
  app.useLogger(
    levels.slice(0, levels.indexOf(config.getOrThrow('LOG_LEVEL')) + 1),
  );
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(correlation);
  app.useBodyParser('json', { limit: '16kb' });
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.enableCors({
    origin: config.getOrThrow<string[]>('CORS_ALLOWED_ORIGINS'),
    credentials: true,
  });
  app.setGlobalPrefix('api', {
    exclude: [{ path: '.well-known/jwks.json', method: RequestMethod.GET }],
  });
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
  const verifier = new JwtVerifier(
    authOptions({
      ...process.env,
      AUTH_JWKS_URL:
        process.env.AUTH_JWKS_URL ??
        'http://127.0.0.1:' +
          config.getOrThrow<number>('PORT') +
          '/.well-known/jwks.json',
    }),
  );
  app.use(swaggerProtection(verifier, true));
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('identity-service')
      .setVersion('1.0.0')
      .addCookieAuth(
        'ambrosia_access',
        { type: 'apiKey', in: 'cookie' },
        'cookieAuth',
      )
      .addBearerAuth(undefined, 'bearerAuth')
      .addServer('..')
      .setDescription(
        'Identidad y sesiones. POST requiere cookie CSRF, binding, X-CSRF-Token y Origin/Referer autorizado. Cookies seguras en producción.',
      )
      .addCookieAuth(
        'ambrosia_access',
        { type: 'apiKey', in: 'cookie' },
        'access',
      )
      .addCookieAuth(
        'ambrosia_refresh',
        { type: 'apiKey', in: 'cookie' },
        'refresh',
      )
      .build(),
  );
  // Session endpoints keep their existing cookie-only contracts; Swagger access accepts either mechanism.
  document.security = [];
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
      message: 'No se pudo iniciar identity-service; revisar configuración.',
    }) + '\n',
  );
  process.exitCode = 1;
});
