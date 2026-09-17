import { describe, it, expect } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { validateIdentityEnv } from './env';
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 3072,
});
const base = {
  NODE_ENV: 'test',
  PORT: 3004,
  DATABASE_URL: 'postgresql://x:y@localhost/db',
  NATS_URL: 'nats://localhost:4222',
  NATS_USER: 'u',
  NATS_PASSWORD: 'p',
  CORS_ALLOWED_ORIGINS: 'http://localhost:8080',
  LOG_LEVEL: 'log',
  JWT_ISSUER: 'http://localhost:8080/api/auth',
  JWT_AUDIENCE: 'ambrosia-services',
  JWT_KEY_ID: 'test-1',
  JWT_PRIVATE_KEY_BASE64: Buffer.from(
    privateKey.export({ type: 'pkcs8', format: 'pem' }),
  ).toString('base64'),
  JWT_PUBLIC_KEY_BASE64: Buffer.from(
    publicKey.export({ type: 'spki', format: 'pem' }),
  ).toString('base64'),
  AUTH_CSRF_SECRET: 'x'.repeat(32),
  AUTH_COOKIE_SECURE: 'false',
};
describe('config identity', () => {
  it('acepta configuración completa', () =>
    expect(validateIdentityEnv(base)).toMatchObject({
      PORT: 3004,
      JWT_ACCESS_TTL_SECONDS: 900,
      AUTH_COOKIE_SECURE: false,
    }));
  it.each([
    'JWT_ISSUER',
    'JWT_AUDIENCE',
    'JWT_KEY_ID',
    'JWT_PRIVATE_KEY_BASE64',
    'JWT_PUBLIC_KEY_BASE64',
    'AUTH_CSRF_SECRET',
  ])('rechaza falta de %s', (key) =>
    expect(() => validateIdentityEnv({ ...base, [key]: undefined })).toThrow(
      key,
    ),
  );
  it('exige cookie segura en producción', () =>
    expect(() =>
      validateIdentityEnv({ ...base, NODE_ENV: 'production' }),
    ).toThrow('AUTH_COOKIE_SECURE'));
});
