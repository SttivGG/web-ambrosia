import { safeReturnTo } from '../lib/auth/return-to';
import { beforeEach, it, expect, vi } from 'vitest';
import { productionRequest } from '../lib/api/production';
import { authenticatedFetch } from '../lib/api/authenticated-fetch';
import { getCsrfToken } from '../lib/auth/client';
vi.mock('../lib/api/authenticated-fetch', () => ({
  authenticatedFetch: vi.fn(),
}));
vi.mock('../lib/auth/client', () => ({ getCsrfToken: vi.fn() }));
const schema = { parse: (v: unknown) => v };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCsrfToken).mockResolvedValue('csrf-test');
});
it('consulta producción exclusivamente por gateway', async () => {
  vi.mocked(authenticatedFetch).mockResolvedValue(new Response('{}'));
  await productionRequest('orders', schema);
  expect(authenticatedFetch).toHaveBeenCalledWith(
    '/api/production/production/orders',
    expect.objectContaining({ method: 'GET' }),
  );
  expect(getCsrfToken).not.toHaveBeenCalled();
});
it('inicio envía CSRF y versión una sola vez', async () => {
  vi.mocked(authenticatedFetch).mockResolvedValue(new Response('{}'));
  await productionRequest('orders/id/start', schema, 'POST', {
    expectedVersion: 4,
  });
  expect(authenticatedFetch).toHaveBeenCalledOnce();
  expect(authenticatedFetch).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'csrf-test',
      },
      body: '{"expectedVersion":4}',
    }),
  );
});
it('conserva conflicto para comparar sin descartar campos', async () => {
  vi.mocked(authenticatedFetch).mockResolvedValue(
    new Response(
      JSON.stringify({
        code: 'CONCURRENT_MODIFICATION',
        message: 'Cambió',
        fields: ['notes'],
      }),
      { status: 409 },
    ),
  );
  await expect(
    productionRequest('orders/id', schema, 'PATCH', {}),
  ).rejects.toMatchObject({
    code: 'CONCURRENT_MODIFICATION',
    fields: ['notes'],
  });
});
it('fallo ambiguo no reenvía la mutación', async () => {
  vi.mocked(authenticatedFetch).mockRejectedValue(Error('privado'));
  await expect(
    productionRequest('orders/id/start', schema, 'POST', {}),
  ).rejects.toThrow('Consulta el estado');
  expect(authenticatedFetch).toHaveBeenCalledOnce();
});
it('rechaza respuesta no compatible', async () => {
  vi.mocked(authenticatedFetch).mockResolvedValue(new Response('{}'));
  await expect(
    productionRequest('orders', {
      parse: () => {
        throw Error('shape');
      },
    }),
  ).rejects.toThrow('Respuesta inválida');
});

it.each(['/produccion/formulas', '/produccion/lotes?search=L1'])(
  'conserva retorno autorizado %s',
  (path) => expect(safeReturnTo(path)).toBe(path),
);
it('no amplía retorno a rutas técnicas', () =>
  expect(safeReturnTo('/produccion/internal')).toBe('/dashboard'));
