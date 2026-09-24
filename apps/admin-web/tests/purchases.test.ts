import { beforeEach, expect, it, vi } from 'vitest';
import { stockV1Schema } from '@ambrosia/contracts';
import { purchaseRequest, PurchaseRequestError } from '../lib/api/purchases';
import { authenticatedFetch } from '../lib/api/authenticated-fetch';
import { getCsrfToken } from '../lib/auth/client';
import { safeReturnTo } from '../lib/auth/return-to';
import { preview, cop, day } from '../components/purchases/common';
vi.mock('../lib/api/authenticated-fetch', () => ({
  authenticatedFetch: vi.fn(),
}));
vi.mock('../lib/auth/client', () => ({ getCsrfToken: vi.fn() }));
const id = '11111111-1111-4111-8111-111111111111';
const stock = {
  itemId: id,
  item: { id, sku: 'ART-1', name: 'Artículo' },
  category: { id, name: 'Categoría' },
  baseUnit: 'GRAM',
  quantity: '0.0000000001',
  active: true,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCsrfToken).mockResolvedValue('csrf-test');
});
it('consulta existencias autenticadas y conserva precisión', async () => {
  vi.mocked(authenticatedFetch).mockResolvedValue(
    new Response(JSON.stringify(stock)),
  );
  expect(
    (await purchaseRequest('inventory/stocks/' + id, stockV1Schema)).quantity,
  ).toBe('0.0000000001');
  expect(getCsrfToken).not.toHaveBeenCalled();
  expect(authenticatedFetch).toHaveBeenCalledWith(
    '/api/inventory/inventory/stocks/' + id,
    expect.objectContaining({ method: 'GET' }),
  );
});
it('envía CSRF y versión sin repetir', async () => {
  vi.mocked(authenticatedFetch).mockResolvedValue(
    new Response(JSON.stringify(stock)),
  );
  await purchaseRequest('purchases/' + id + '/receive', stockV1Schema, 'POST', {
    expectedVersion: 2,
  });
  expect(authenticatedFetch).toHaveBeenCalledOnce();
  expect(authenticatedFetch).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'csrf-test',
      },
      body: JSON.stringify({ expectedVersion: 2 }),
    }),
  );
});
it('conserva conflicto y campos', async () => {
  vi.mocked(authenticatedFetch).mockResolvedValue(
    new Response(
      JSON.stringify({
        code: 'CONCURRENT_MODIFICATION',
        message: 'Cambió',
        fields: ['reference'],
      }),
      { status: 409 },
    ),
  );
  await expect(
    purchaseRequest('purchases/id', stockV1Schema, 'PATCH', {}),
  ).rejects.toMatchObject({
    code: 'CONCURRENT_MODIFICATION',
    fields: ['reference'],
  });
  expect(authenticatedFetch).toHaveBeenCalledOnce();
});
it('no repite fallos ambiguos de recepción', async () => {
  vi.mocked(authenticatedFetch).mockRejectedValue(new Error('SQL privado'));
  await expect(
    purchaseRequest('purchases/id/receive', stockV1Schema, 'POST', {}),
  ).rejects.toThrow('Consulta el estado');
  expect(authenticatedFetch).toHaveBeenCalledOnce();
});
it('rechaza respuesta inválida', async () => {
  vi.mocked(authenticatedFetch).mockResolvedValue(new Response('{}'));
  await expect(
    purchaseRequest('inventory/stocks/id', stockV1Schema),
  ).rejects.toBeInstanceOf(PurchaseRequestError);
});
it('403 no expone detalles internos', async () => {
  vi.mocked(authenticatedFetch).mockResolvedValue(
    new Response('private', { status: 403 }),
  );
  await expect(purchaseRequest('purchases', stockV1Schema)).rejects.toThrow(
    'No tienes permiso',
  );
});
it('vista previa redondea por línea sin floats', () => {
  expect(
    preview([
      { quantity: '2.5', unitCost: '100.01' },
      { quantity: '0.5', unitCost: '0.01' },
    ]),
  ).toBe('250.04');
  expect(preview([{ quantity: '1', unitCost: '9007199254740993.01' }])).toBe(
    '9007199254740993.01',
  );
  expect(preview([{ quantity: '1e3', unitCost: '1' }])).toBeNull();
});
it('COP conserva importes grandes', () =>
  expect(cop('9007199254740993.01')).toBe('$ 9.007.199.254.740.993,01 COP'));
it('fecha usa Bogotá', () =>
  expect(day('2026-09-22T02:00:00Z')).toBe('2026-09-21'));
it.each(['compras', 'existencias', 'movimientos'])(
  'permite retorno a %s',
  (path) => {
    expect(safeReturnTo('/inventario/' + path)).toBe('/inventario/' + path);
    expect(
      safeReturnTo('/inventario/' + path + '/../../../api/auth/logout'),
    ).toBe('/dashboard');
  },
);
