import 'reflect-metadata';
import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
  Injectable,
  Inject,
  Module,
  type DynamicModule,
  type CanActivate,
} from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { PERMISSIONS_V1, type PermissionV1 } from '@ambrosia/contracts';
import { authOptions, type AuthOptions } from './config';
import { JwtVerifier } from './verifier';
import { AuthError, authEvent, sendAuthError } from './errors';
import { cookie, credentials, type AuthRequest } from './credentials';
export * from './config';
export * from './credentials';
export * from './errors';
export * from './verifier';
const PUBLIC = Symbol('public');
const PERMISSIONS = Symbol('permissions');
export const Public = () => SetMetadata(PUBLIC, true);
export const RequirePermissions = (...permissions: PermissionV1[]) => {
  if (
    !permissions.length ||
    permissions.some((p) => !PERMISSIONS_V1.includes(p))
  )
    throw new Error('Permisos explícitos requeridos');
  return SetMetadata(PERMISSIONS, Object.freeze([...permissions]));
};
export const CurrentAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest<AuthRequest>().auth,
);
const isPublic = (reflector: Reflector, ctx: ExecutionContext) =>
  reflector.get<boolean>(PUBLIC, ctx.getHandler()) === true;
export async function authenticate(req: AuthRequest, verifier: JwtVerifier) {
  try {
    const { token, method } = credentials(req, verifier.options);
    const claims = await verifier.verify(token);
    const auth = Object.freeze({
      subject: claims.sub,
      sessionId: claims.sid,
      tokenId: claims.jti,
      role: claims.role,
      permissions: Object.freeze([...claims.permissions]),
      authenticationMethod: method,
    });
    Object.defineProperty(req, 'auth', {
      value: auth,
      writable: false,
      configurable: false,
    });
    return auth;
  } catch (error) {
    authEvent('authentication.failed');
    throw error;
  }
}
export function requirePermissions(
  req: AuthRequest,
  permissions: readonly PermissionV1[] | undefined,
) {
  if (!req.auth) throw new AuthError(401);
  if (
    !permissions?.length ||
    !permissions.every((p) => req.auth!.permissions.includes(p))
  ) {
    authEvent('authorization.denied');
    throw new AuthError(403);
  }
}
export function validateCsrf(req: AuthRequest, options: AuthOptions) {
  if (
    req.auth?.authenticationMethod !== 'cookie' ||
    ['GET', 'HEAD', 'OPTIONS'].includes(req.method)
  )
    return;
  let origin = req.get('origin');
  if (!origin) {
    try {
      origin = new URL(req.get('referer') ?? '').origin;
    } catch {
      throw new AuthError(403);
    }
  }
  const header = req.get(options.CSRF_HEADER_NAME),
    value = cookie(req, options.CSRF_COOKIE_NAME);
  if (
    !options.AUTH_ALLOWED_ORIGINS.includes(origin) ||
    !header ||
    !value ||
    !/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/.test(header) ||
    !/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/.test(value) ||
    !timingSafeEqual(Buffer.from(header), Buffer.from(value))
  )
    throw new AuthError(403);
}
@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(
    @Inject(JwtVerifier) private readonly verifier: JwtVerifier,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}
  async canActivate(ctx: ExecutionContext) {
    if (isPublic(this.reflector, ctx)) return true;
    ctx
      .switchToHttp()
      .getResponse<Response>()
      .setHeader('Cache-Control', 'private, no-store');
    await authenticate(
      ctx.switchToHttp().getRequest<AuthRequest>(),
      this.verifier,
    );
    return true;
  }
}
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}
  canActivate(ctx: ExecutionContext) {
    if (isPublic(this.reflector, ctx)) return true;
    requirePermissions(
      ctx.switchToHttp().getRequest<AuthRequest>(),
      this.reflector.getAllAndOverride<PermissionV1[]>(PERMISSIONS, [
        ctx.getHandler(),
        ctx.getClass(),
      ]),
    );
    return true;
  }
}
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    @Inject(JwtVerifier) private readonly verifier: JwtVerifier,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}
  canActivate(ctx: ExecutionContext) {
    if (!isPublic(this.reflector, ctx))
      validateCsrf(
        ctx.switchToHttp().getRequest<AuthRequest>(),
        this.verifier.options,
      );
    return true;
  }
}
@Module({})
export class NestAuthModule {
  static register(options: AuthOptions): DynamicModule {
    return {
      module: NestAuthModule,
      providers: [
        { provide: JwtVerifier, useFactory: () => new JwtVerifier(options) },
        { provide: APP_GUARD, useClass: AuthenticationGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
        { provide: APP_GUARD, useClass: CsrfGuard },
      ],
      exports: [JwtVerifier],
    };
  }
}
export function swaggerProtection(verifier: JwtVerifier, identity = false) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Swagger mounts outside Nest controllers: protect UI, JSON, YAML and all assets before setup.
    let path: string;
    try {
      path = decodeURIComponent(req.path).toLowerCase();
    } catch {
      return sendAuthError(new AuthError(401), res);
    }
    if (!path.startsWith('/docs')) return next();
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      const auth = await authenticate(req, verifier);
      if (identity) requirePermissions(req, ['users.manage']);
      else if (!['OWNER', 'ADMIN'].includes(auth.role)) {
        authEvent('authorization.denied');
        throw new AuthError(403);
      }
      validateCsrf(req, verifier.options);
      next();
    } catch (error) {
      sendAuthError(
        error instanceof AuthError ? error : new AuthError(401),
        res,
      );
    }
  };
}
export function verifierFromEnv(env: Record<string, unknown>) {
  return new JwtVerifier(authOptions(env));
}

export { swaggerOptions } from './swagger';
