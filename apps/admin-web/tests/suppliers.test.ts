import { beforeEach, expect, it, vi } from 'vitest';
import { supplierV1Schema } from '@ambrosia/contracts';
import { supplierRequest, SupplierRequestError } from '../lib/api/suppliers';
import { authenticatedFetch } from '../lib/api/authenticated-fetch';
import { getCsrfToken } from '../lib/auth/client';
import { safeReturnTo } from '../lib/auth/return-to';
vi.mock('../lib/api/authenticated-fetch', () => ({
  authenticatedFetch: vi.fn(),
}));
vi.mock('../lib/auth/client', () => ({ getCsrfToken: vi.fn() }));
const category = {
  id: 'a1111111-1111-4111-8111-111111111111',
  name: 'Leche',

  code: 'PROV-001',
  tradeName: null,
  identificationType: null,
  identificationNumber: null,
  contactName: null,
  email: null,
  phone: null,
  address: null,
  municipality: null,
  department: null,
  notes: null,
  items: [],
  active: true,
  version: 1,
  createdAt: '2026-09-17T00:00:00.000Z',
  updatedAt: '2026-09-17T00:00:00.000Z',
  archivedAt: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCsrfToken).mockResolvedValue('csrf-test');
});
it('lectura usa cliente autenticado y ruta relativa Nginx', async () => {
  vi.mocked(authenticatedFetch).mockResolvedValue(
    new Response(JSON.stringify(category)),
  );
  expect(await supplierRequest('/' + category.id, supplierV1Schema)).toEqual(
    category,
  );
  expect(authenticatedFetch).toHaveBeenCalledWith(
    '/api/inventory/suppliers/' + category.id,
    expect.objectContaining({ method: 'GET' }),
  );
  expect(getCsrfToken).not.toHaveBeenCalled();
});
it('mutación obtiene CSRF y envía expectedVersion sin repetir', async () => {
  vi.mocked(authenticatedFetch).mockResolvedValue(
    new Response(JSON.stringify(category)),
  );
  await supplierRequest('/' + category.id, supplierV1Schema, 'PATCH', {
    expectedVersion: 1,
    name: 'Leche',
  });
  expect(getCsrfToken).toHaveBeenCalledOnce();
  expect(authenticatedFetch).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'csrf-test',
      },
      body: JSON.stringify({ expectedVersion: 1, name: 'Leche' }),
    }),
  );
});
it('conflicto conserva código y campos y no se reintenta', async () => {
  vi.mocked(authenticatedFetch).mockResolvedValue(
    new Response(
      JSON.stringify({
        code: 'CONCURRENT_MODIFICATION',
        message: 'Versión obsoleta',
        fields: ['name'],
      }),
      { status: 409 },
    ),
  );
  await expect(
    supplierRequest('/id', supplierV1Schema, 'PATCH', {}),
  ).rejects.toMatchObject({
    code: 'CONCURRENT_MODIFICATION',
    fields: ['name'],
  });
  expect(authenticatedFetch).toHaveBeenCalledOnce();
});
it('fallo de red no repite mutación de resultado ambiguo', async () => {
  vi.mocked(authenticatedFetch).mockRejectedValue(
    new Error('network internals'),
  );
  await expect(
    supplierRequest('', supplierV1Schema, 'POST', {}),
  ).rejects.toThrow('Tus datos siguen');
  expect(authenticatedFetch).toHaveBeenCalledOnce();
});
it('rechaza respuestas inválidas sin exponer contenido', async () => {
  vi.mocked(authenticatedFetch).mockResolvedValue(
    new Response(JSON.stringify({ secret: 'private SQL' })),
  );
  await expect(supplierRequest('', supplierV1Schema)).rejects.toBeInstanceOf(
    SupplierRequestError,
  );
});
it('403 sin error de proveedores usa mensaje seguro', async () => {
  vi.mocked(authenticatedFetch).mockResolvedValue(
    new Response(JSON.stringify({ message: 'private internals' }), {
      status: 403,
    }),
  );
  await expect(supplierRequest('', supplierV1Schema)).rejects.toThrow(
    'No tienes permiso',
  );
});
it('permite retorno a proveedores y rechaza escape del panel', () => {
  expect(safeReturnTo('/inventario/proveedores?active=true')).toBe(
    '/inventario/proveedores?active=true',
  );
  expect(safeReturnTo('/inventario/proveedores/../../api/auth/logout')).toBe(
    '/dashboard',
  );
  expect(safeReturnTo('/inventario/proveedoresotro')).toBe('/dashboard');
});
