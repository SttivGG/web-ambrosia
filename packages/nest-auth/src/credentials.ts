import type { Request } from 'express';
import type { PermissionV1, RoleV1 } from '@ambrosia/contracts';
import type { AuthOptions } from './config';
import { AuthError } from './errors';
export type AuthContext = Readonly<{
  subject: string;
  sessionId: string;
  tokenId: string;
  role: RoleV1;
  permissions: readonly PermissionV1[];
  authenticationMethod: 'cookie' | 'bearer';
}>;
export type AuthRequest = Request & { readonly auth?: AuthContext };
export function cookie(req: Request, name: string): string | undefined {
  const parts = (req.headers.cookie ?? '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.startsWith(name + '='));
  if (parts.length > 1) throw new AuthError(401);
  if (!parts.length) return undefined;
  try {
    return decodeURIComponent(parts[0]!.slice(name.length + 1));
  } catch {
    throw new AuthError(401);
  }
}
export function credentials(req: Request, options: AuthOptions) {
  if (
    Object.keys(req.query ?? {}).some((k) => /token|authorization|jwt/i.test(k))
  )
    throw new AuthError(401);
  const access = cookie(req, options.ACCESS_COOKIE_NAME);
  const authorization = req.headers.authorization;
  let bearer: string | undefined;
  if (authorization !== undefined) {
    const match = /^Bearer ([A-Za-z0-9_.-]+)$/i.exec(authorization);
    if (!match) throw new AuthError(401);
    bearer = match[1];
  }
  if (access !== undefined && (!access || (bearer && access !== bearer)))
    throw new AuthError(401);
  const token = access ?? bearer;
  if (!token || token.length > 8192) throw new AuthError(401);
  // Any ambient access cookie keeps CSRF mandatory, including identical Bearer credentials.
  return {
    token,
    method: access !== undefined ? ('cookie' as const) : ('bearer' as const),
  };
}
