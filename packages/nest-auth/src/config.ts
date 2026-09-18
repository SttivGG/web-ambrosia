import { z } from 'zod';
const positive = (value: number, max: number) =>
  z.coerce.number().int().min(1).max(max).default(value);
const origin = z
  .string()
  .url()
  .refine((v) => {
    try {
      return new URL(v).origin === v;
    } catch {
      return false;
    }
  });
const schema = z.object({
  AUTH_JWKS_URL: z
    .string()
    .url()
    .refine((v) => {
      const u = new URL(v);
      return (
        ['http:', 'https:'].includes(u.protocol) &&
        !u.username &&
        !u.password &&
        !u.search &&
        !u.hash
      );
    }),
  AUTH_ISSUER: z.string().url(),
  AUTH_AUDIENCE: z.string().min(1),
  AUTH_ALLOWED_ALGORITHM: z.literal('RS256').default('RS256'),
  AUTH_JWKS_TIMEOUT_MS: positive(2000, 10000),
  AUTH_JWKS_CACHE_TTL_SECONDS: positive(300, 3600),
  ACCESS_COOKIE_NAME: z.literal('ambrosia_access').default('ambrosia_access'),
  CSRF_COOKIE_NAME: z.literal('ambrosia_csrf').default('ambrosia_csrf'),
  CSRF_HEADER_NAME: z.literal('x-csrf-token').default('x-csrf-token'),
  AUTH_ALLOWED_ORIGINS: z.preprocess(
    (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()) : v),
    z.array(origin).min(1),
  ),
});
export type AuthOptions = z.infer<typeof schema>;
export function authOptions(env: Record<string, unknown>): AuthOptions {
  const parsed = schema.safeParse({
    ...env,
    AUTH_ISSUER: env.AUTH_ISSUER ?? env.JWT_ISSUER,
    AUTH_AUDIENCE: env.AUTH_AUDIENCE ?? env.JWT_AUDIENCE,
    AUTH_ALLOWED_ORIGINS: env.AUTH_ALLOWED_ORIGINS ?? env.CORS_ALLOWED_ORIGINS,
  });
  if (!parsed.success)
    throw new Error(
      'Configuración de autenticación inválida: ' +
        parsed.error.issues.map((i) => i.path.join('.')).join(', '),
    );
  return parsed.data;
}
