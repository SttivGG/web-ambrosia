import { describe, it, expect } from 'vitest';
import { validateServiceEnv } from '../packages/shared-config/src';
const valid = {
  PORT: 3001,
  DATABASE_URL: 'postgresql://user:secret@localhost/db',
  NATS_URL: 'nats://localhost:4222',
  NATS_USER: 'local',
  NATS_PASSWORD: 'test-secret',
  CORS_ALLOWED_ORIGINS: 'http://localhost:8080',
};
describe('configuración de arranque', () => {
  it('valida y transforma puertos y orígenes', () =>
    expect(validateServiceEnv(valid)).toMatchObject({
      PORT: 3001,
      CORS_ALLOWED_ORIGINS: ['http://localhost:8080'],
    }));
  it.each([
    'DATABASE_URL',
    'NATS_URL',
    'NATS_USER',
    'NATS_PASSWORD',
    'PORT',
    'CORS_ALLOWED_ORIGINS',
  ])('rechaza falta de %s', (key) => {
    const input = { ...valid, [key]: undefined };
    expect(() => validateServiceEnv(input)).toThrow(key);
  });
  it.each([0, 65536, 'wrong'])('rechaza puerto %s', (PORT) =>
    expect(() => validateServiceEnv({ ...valid, PORT })).toThrow('PORT'),
  );
  it('rechaza CORS comodín', () =>
    expect(() =>
      validateServiceEnv({ ...valid, CORS_ALLOWED_ORIGINS: '*' }),
    ).toThrow('CORS_ALLOWED_ORIGINS'));
  it('no filtra secretos en errores', () => {
    try {
      validateServiceEnv({ ...valid, DATABASE_URL: 'private-password' });
    } catch (error) {
      expect(String(error)).not.toContain('private-password');
    }
  });
});
