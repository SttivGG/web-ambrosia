import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
// @ts-expect-error Runtime-only Node script has no declaration file.
import { developmentGateway } from '../scripts/dev-gateway.mjs';
it('todas las rutas Identity apuntan al host en desarrollo', () => {
  const original = readFileSync('infrastructure/nginx/nginx.conf', 'utf8');
  const generated = developmentGateway(original, {
    IDENTITY_SERVICE_PORT: '3104',
  });
  expect(generated).not.toContain('identity-service:3004');
  expect(generated.match(/host\.docker\.internal:3104/g)).toHaveLength(4);
});
it('el gateway de desarrollo rechaza puertos inválidos', () => {
  expect(() =>
    developmentGateway('', { IDENTITY_SERVICE_PORT: '70000' }),
  ).toThrow('IDENTITY_SERVICE_PORT');
});
