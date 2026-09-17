import { z } from 'zod';
export const serviceEnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535),
  DATABASE_URL: z
    .string()
    .url()
    .refine((v) => /^postgres(ql)?:/.test(v), 'PostgreSQL requerido'),
  NATS_URL: z
    .string()
    .url()
    .refine((v) => /^nats:/.test(v), 'NATS requerido'),
  NATS_USER: z.string().min(1),
  NATS_PASSWORD: z.string().min(1),
  CORS_ALLOWED_ORIGINS: z
    .string()
    .min(1)
    .transform((v) => v.split(',').map((s) => s.trim()))
    .pipe(
      z
        .array(
          z
            .string()
            .url()
            .refine((v) => {
              try {
                const url = new URL(v);
                return (
                  ['http:', 'https:'].includes(url.protocol) && url.origin === v
                );
              } catch {
                return false;
              }
            }, 'Usar origen sin ruta'),
        )
        .min(1),
    ),
  LOG_LEVEL: z
    .enum(['error', 'warn', 'log', 'debug', 'verbose'])
    .default('log'),
});
export type ServiceEnv = z.infer<typeof serviceEnvSchema>;
export function validateServiceEnv(input: unknown): ServiceEnv {
  const result = serviceEnvSchema.safeParse(input);
  if (!result.success)
    throw new Error(
      'Configuración inválida: ' +
        result.error.issues.map((i) => i.path.join('.')).join(', '),
    );
  return result.data;
}
