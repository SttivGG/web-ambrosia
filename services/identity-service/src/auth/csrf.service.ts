import { Injectable, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response, CookieOptions } from 'express';

export const COOKIE = {
  access: 'ambrosia_access',
  refresh: 'ambrosia_refresh',
  csrf: 'ambrosia_csrf',
  binding: 'ambrosia_csrf_bind',
} as const;
// Cookie parsing is deliberately bounded and rejects duplicates, avoiding cookie shadowing.
export function readCookie(req: Request, name: string): string | undefined {
  const values = (req.headers.cookie ?? '')
    .split(';')
    .map((p) => p.trim())
    .filter((p) => p.startsWith(name + '='));
  if (values.length !== 1) return undefined;
  try {
    return decodeURIComponent(values[0]!.slice(name.length + 1));
  } catch {
    return undefined;
  }
}
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
@Injectable()
export class CsrfService {
  constructor(private readonly config: ConfigService) {}
  options(httpOnly: boolean, path = '/'): CookieOptions {
    return {
      httpOnly,
      path,
      secure: this.config.getOrThrow<boolean>('AUTH_COOKIE_SECURE'),
      sameSite: 'lax',
    };
  }
  private signature(nonce: string, binding: string) {
    return createHmac(
      'sha256',
      this.config.getOrThrow<string>('AUTH_CSRF_SECRET'),
    )
      .update(nonce + '.' + binding)
      .digest('base64url');
  }
  issue(req: Request, res: Response) {
    const binding =
      readCookie(req, COOKIE.binding) ?? randomBytes(32).toString('base64url');
    const nonce = randomBytes(32).toString('base64url');
    const token = nonce + '.' + this.signature(nonce, binding);
    const maxAge =
      this.config.getOrThrow<number>('AUTH_REFRESH_TTL_SECONDS') * 1000;
    res.cookie(COOKIE.binding, binding, { ...this.options(true), maxAge });
    res.cookie(COOKIE.csrf, token, { ...this.options(false), maxAge });
    return { csrfToken: token };
  }
  validate(req: Request) {
    let origin = req.get('origin');
    if (!origin) {
      try {
        origin = new URL(req.get('referer') ?? '').origin;
      } catch {
        throw new ForbiddenException();
      }
    }
    if (
      !this.config.getOrThrow<string[]>('CORS_ALLOWED_ORIGINS').includes(origin)
    )
      throw new ForbiddenException();
    const header = req.get('x-csrf-token'),
      cookie = readCookie(req, COOKIE.csrf),
      binding = readCookie(req, COOKIE.binding);
    if (
      !header ||
      header.length > 128 ||
      !cookie ||
      !binding ||
      binding.length > 128 ||
      !safeEqual(header, cookie)
    )
      throw new ForbiddenException();
    const [nonce, signature, ...extra] = header.split('.');
    if (
      !nonce ||
      !signature ||
      extra.length ||
      !/^[A-Za-z0-9_-]{43}$/.test(nonce) ||
      !safeEqual(signature, this.signature(nonce, binding))
    )
      throw new ForbiddenException();
  }
  setAuth(res: Response, access: string, refresh: string, expiresAt: Date) {
    res.cookie(COOKIE.access, access, {
      ...this.options(true),
      maxAge: this.config.getOrThrow<number>('JWT_ACCESS_TTL_SECONDS') * 1000,
    });
    res.cookie(COOKIE.refresh, refresh, {
      ...this.options(
        true,
        this.config.getOrThrow<string>('AUTH_REFRESH_COOKIE_PATH'),
      ),
      expires: expiresAt,
    });
  }
  clear(res: Response) {
    res.clearCookie(COOKIE.access, this.options(true));
    res.clearCookie(
      COOKIE.refresh,
      this.options(
        true,
        this.config.getOrThrow<string>('AUTH_REFRESH_COOKIE_PATH'),
      ),
    );
    res.clearCookie(COOKIE.csrf, this.options(false));
    res.clearCookie(COOKIE.binding, this.options(true));
  }
}
