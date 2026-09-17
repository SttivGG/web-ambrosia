import { z } from 'zod';
import { validateServiceEnv } from '@ambrosia/shared-config';
const positive = (fallback: number, max: number) =>
  z.coerce.number().int().min(1).max(max).default(fallback);
export const identitySchema = z.object({
  JWT_ISSUER: z.string().url(),
  JWT_AUDIENCE: z.string().min(1),
  JWT_KEY_ID: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  JWT_PRIVATE_KEY_BASE64: z.string().min(64),
  JWT_PUBLIC_KEY_BASE64: z.string().min(64),
  JWT_ACCESS_TTL_SECONDS: positive(900, 900),
  AUTH_REFRESH_TTL_SECONDS: positive(604800, 2592000),
  AUTH_CSRF_SECRET: z.string().min(32),
  AUTH_MAX_FAILED_ATTEMPTS: positive(5, 100),
  AUTH_LOCKOUT_MINUTES: positive(15, 1440),
  AUTH_LOGIN_RATE_LIMIT: positive(20, 1000),
  AUTH_LOGIN_RATE_WINDOW_SECONDS: positive(60, 3600),
  AUTH_COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  AUTH_REFRESH_COOKIE_PATH: z
    .string()
    .regex(/^\/(?:api\/auth|api\/v1\/auth)$/)
    .default('/api/auth'),
});
export function validateIdentityEnv(env: Record<string, unknown>) {
  const common = validateServiceEnv({
    ...env,
    PORT: env.PORT ?? env.IDENTITY_SERVICE_PORT,
    DATABASE_URL: env.DATABASE_URL ?? env.IDENTITY_DATABASE_URL,
  });
  const result = identitySchema.safeParse(env);
  if (!result.success)
    throw new Error(
      'Configuración inválida: ' +
        result.error.issues.map((i) => i.path.join('.')).join(', '),
    );
  if (common.NODE_ENV === 'production' && !result.data.AUTH_COOKIE_SECURE)
    throw new Error(
      'Configuración inválida: AUTH_COOKIE_SECURE requerido en producción',
    );
  return { ...common, ...result.data };
}
