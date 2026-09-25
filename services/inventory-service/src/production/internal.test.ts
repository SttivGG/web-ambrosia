import { afterEach, it, expect, vi } from 'vitest';
import { internalAuth } from './internal.controller';
afterEach(() => vi.unstubAllEnvs());
it.each([undefined, '', 'Bearer short', 'Bearer ' + 'b'.repeat(96)])(
  'rechaza credencial técnica inválida %s',
  (token) => {
    vi.stubEnv('PRODUCTION_INVENTORY_TOKEN', 'a'.repeat(96));
    expect(() => internalAuth(token, undefined)).toThrow();
  },
);
it('acepta credencial técnica exacta', () => {
  vi.stubEnv('PRODUCTION_INVENTORY_TOKEN', 'a'.repeat(96));
  expect(() =>
    internalAuth('Bearer ' + 'a'.repeat(96), undefined),
  ).not.toThrow();
});
it('rechaza cookies en rutas técnicas', () => {
  vi.stubEnv('PRODUCTION_INVENTORY_TOKEN', 'a'.repeat(96));
  expect(() =>
    internalAuth('Bearer ' + 'a'.repeat(96), 'session=present'),
  ).toThrow();
});
it('sin configuración falla cerrado', () => {
  vi.stubEnv('PRODUCTION_INVENTORY_TOKEN', '');
  expect(() => internalAuth('Bearer ', undefined)).toThrow();
});
