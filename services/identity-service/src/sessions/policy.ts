import { createHash, randomBytes } from 'node:crypto';
export const newRefreshToken = () => randomBytes(32).toString('base64url');
export const tokenHash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export function sessionState(
  session: {
    replacedBySessionId: string | null;
    revokedAt: Date | null;
    expiresAt: Date;
  },
  now: Date,
): 'reuse' | 'invalid' | 'active' {
  if (session.replacedBySessionId) return 'reuse';
  return session.revokedAt || session.expiresAt <= now ? 'invalid' : 'active';
}
export function failedAttempt(
  attempts: number,
  lockedUntil: Date | null,
  now: Date,
  max: number,
  minutes: number,
) {
  const count = (lockedUntil && lockedUntil <= now ? 0 : attempts) + 1;
  return {
    failedLoginAttempts: count,
    lockedUntil:
      count >= max ? new Date(now.getTime() + minutes * 60000) : null,
    status: count >= max ? ('LOCKED' as const) : ('ACTIVE' as const),
  };
}
