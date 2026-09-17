import { afterEach, it, expect, vi } from 'vitest';
import { checkService } from './status';
afterEach(() => vi.unstubAllGlobals());
it('solo consulta gateway y valida dependencias', async () => {
  const fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      service: 'inventory-service',
      status: 'ok',
      dependencies: { database: true, nats: true },
    }),
  });
  vi.stubGlobal('fetch', fetch);
  expect(await checkService('inventory', 'inventory-service')).toBe(
    'available',
  );
  expect(fetch.mock.calls[0]?.[0]).toBe('/api/inventory/health/ready');
});
it.each([503, 502])('rechaza HTTP %s', async (status) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status }));
  expect(await checkService('finance', 'finance-reporting-service')).toBe(
    'unavailable',
  );
});
it('captura errores de red', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  expect(await checkService('production', 'production-service')).toBe(
    'unavailable',
  );
});
it('rechaza respuesta ajena', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ status: 'ok' }) }),
  );
  expect(await checkService('production', 'production-service')).toBe(
    'unavailable',
  );
});
