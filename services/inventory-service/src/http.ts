import { PurchaseError } from './purchases/domain';
import { SupplierError } from './suppliers/domain';
import { CatalogError } from './catalog/domain';
import { AuthError, sendAuthError } from '@ambrosia/nest-auth';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
const logger = new Logger('HTTP');
export function correlation(req: Request, res: Response, next: NextFunction) {
  const header = req.header('x-request-id');
  const id =
    header && /^[a-zA-Z0-9._-]{1,128}$/.test(header) ? header : randomUUID();
  res.setHeader('X-Request-ID', id);
  const start = performance.now();
  res.on('finish', () =>
    logger.log({
      event: 'http.request',
      method: req.method,
      path: req.path,
      status: res.statusCode,
      requestId: id,
      durationMs: Math.round(performance.now() - start),
    }),
  );
  next();
}
@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    if (
      error instanceof PurchaseError ||
      error instanceof CatalogError ||
      error instanceof SupplierError
    ) {
      response.status(error.getStatus()).json({
        ...(error.getResponse() as object),
        requestId: response.getHeader('X-Request-ID'),
      });
      return;
    }
    if (error instanceof AuthError) {
      sendAuthError(error, response);
      return;
    }
    const status = error instanceof HttpException ? error.getStatus() : 500;
    const body =
      error instanceof HttpException ? error.getResponse() : undefined;
    if (
      status === 503 &&
      typeof body === 'object' &&
      body !== null &&
      'dependencies' in body
    ) {
      response.status(status).json(body);
      return;
    }
    response.status(status).json({
      statusCode: status,
      message: status >= 500 ? 'Servicio no disponible' : 'Solicitud rechazada',
      requestId: response.getHeader('X-Request-ID'),
      timestamp: new Date().toISOString(),
    });
  }
}
