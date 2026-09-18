import { HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
const logger = new Logger('Auth');
export function authEvent(
  event:
    | 'authentication.failed'
    | 'authorization.denied'
    | 'jwks.refresh.failed'
    | 'jwks.key.unknown',
) {
  logger.warn({ event });
}
export class AuthError extends HttpException {
  constructor(status: 401 | 403 | 503) {
    super(
      {
        statusCode: status,
        code:
          status === 401
            ? 'AUTHENTICATION_REQUIRED'
            : status === 403
              ? 'ACCESS_DENIED'
              : 'AUTHENTICATION_UNAVAILABLE',
        message:
          status === 401
            ? 'Se requiere autenticación.'
            : status === 403
              ? 'Acceso denegado.'
              : 'Autenticación temporalmente no disponible.',
      },
      status,
    );
  }
}
export function sendAuthError(error: AuthError, response: Response) {
  response.setHeader('Cache-Control', 'private, no-store');
  response.status(error.getStatus()).json({
    ...(error.getResponse() as object),
    correlationId: response.getHeader('X-Request-ID'),
  });
}
