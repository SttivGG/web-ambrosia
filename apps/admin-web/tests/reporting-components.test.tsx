// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ReportingInfrastructure } from '../components/reporting/reporting';
import { reportingApi } from '../lib/api/reporting';
import { useSession } from '../components/auth/session-provider';

vi.mock('../lib/api/reporting', () => ({
  reportingApi: {
    health: vi.fn(),
    inventory: vi.fn(),
    inventorySummary: vi.fn(),
    movements: vi.fn(),
    purchases: vi.fn(),
    purchaseSummary: vi.fn(),
    suppliers: vi.fn(),
    production: vi.fn(),
    productionSummary: vi.fn(),
    yield: vi.fn(),
    yieldSummary: vi.fn(),
    waste: vi.fn(),
    wasteSummary: vi.fn(),
    packaging: vi.fn(),
  },
}));
vi.mock('../components/auth/session-provider', () => ({ useSession: vi.fn() }));
const health = {
  status: 'ok' as const,
  timestamp: '2026-09-28T12:00:00.000Z',
  projections: {
    inventoryItems: 0,
    inventoryMovements: 0,
    productionBatches: 0,
    saleMargins: 0,
    purchaseItems: 0,
    packagingOperations: 0,
  },
};
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(useSession).mockReturnValue({
    permissions: ['reports.read'],
  } as unknown as ReturnType<typeof useSession>);
  vi.mocked(reportingApi.health).mockResolvedValue(health);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.clearAllMocks();
  vi.useRealTimers();
});

it('muestra loading y luego resumen con navegación completa', async () => {
  await act(async () => root.render(<ReportingInfrastructure />));
  expect(host.querySelector('[role="status"]')?.textContent).toContain(
    'Consultando Reporting',
  );
  await act(async () => vi.runAllTimersAsync());
  expect(host.textContent).toContain('purchaseItems');
  expect(host.querySelectorAll('.reports-nav button')).toHaveLength(9);
});
it('muestra error anunciado y permite reintentar', async () => {
  vi.mocked(reportingApi.health).mockRejectedValue(new Error('unavailable'));
  await act(async () => root.render(<ReportingInfrastructure />));
  await act(async () => vi.runAllTimersAsync());
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    'No pudimos consultar Reporting',
  );
  expect(host.textContent).toContain('Reintentar');
});
it('muestra permiso denegado sin consultar la API', async () => {
  vi.mocked(useSession).mockReturnValue({
    permissions: [],
  } as unknown as ReturnType<typeof useSession>);
  await act(async () => root.render(<ReportingInfrastructure />));
  await act(async () => vi.runAllTimersAsync());
  expect(host.textContent).toContain('No tienes permiso');
  expect(reportingApi.health).not.toHaveBeenCalled();
});
it('presenta empty state al abrir una vista sin resultados', async () => {
  vi.mocked(reportingApi.inventory).mockResolvedValue({
    data: [],
    pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
  });
  vi.mocked(reportingApi.inventorySummary).mockResolvedValue({
    metrics: {
      valorInventarioValorado: null,
      articulosConExistencia: 0,
      articulosSinValorar: 0,
    },
  });
  await act(async () => root.render(<ReportingInfrastructure />));
  await act(async () => vi.runAllTimersAsync());
  const button = [...host.querySelectorAll('button')].find(
    (entry) => entry.textContent === 'Inventario',
  )!;
  await act(async () => button.click());
  await act(async () => vi.runAllTimersAsync());
  expect(host.textContent).toContain('No hay datos para estos filtros');
});
it('expone filtros propios de compras sin consultar mientras se escriben', async () => {
  vi.mocked(reportingApi.purchases).mockResolvedValue({
    data: [],
    pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
  });
  vi.mocked(reportingApi.purchaseSummary).mockResolvedValue({
    metrics: {
      totalComprado: null,
      numeroCompras: 0,
      proveedores: 0,
      costoPromedioPonderado: null,
    },
  });
  await act(async () => root.render(<ReportingInfrastructure />));
  await act(async () => vi.runAllTimersAsync());
  const button = [...host.querySelectorAll('button')].find(
    (entry) => entry.textContent === 'Compras',
  )!;
  await act(async () => button.click());
  await act(async () => vi.runAllTimersAsync());
  expect(host.textContent).toContain('ID proveedor');
  expect(host.textContent).toContain('ID artículo');
  expect(host.textContent).toContain('ID categoría');
  expect(host.textContent).toContain('Recibida');
});
it('distingue UNVALUED de cero en inventario', async () => {
  vi.mocked(reportingApi.inventory).mockResolvedValue({
    data: [
      {
        sourceService: 'inventory-service',
        sourceEntityId: '00000000-0000-4000-8000-000000000001',
        sourceVersion: 1,
        operationId: null,
        eventId: '00000000-0000-4000-8000-000000000002',
        occurredAt: health.timestamp,
        processedAt: health.timestamp,
        itemId: '00000000-0000-4000-8000-000000000001',
        itemNameSnapshot: 'Leche',
        itemType: 'RAW_MATERIAL',
        unit: 'MILLILITER',
        onHand: '10',
        valuationStatus: 'UNVALUED',
        weightedAverageCost: null,
        inventoryValue: null,
        active: true,
        updatedAt: health.timestamp,
      },
    ],
    pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
  });
  vi.mocked(reportingApi.inventorySummary).mockResolvedValue({
    metrics: {
      valorInventarioValorado: null,
      articulosConExistencia: 1,
      articulosSinValorar: 1,
    },
  });
  await act(async () => root.render(<ReportingInfrastructure />));
  await act(async () => vi.runAllTimersAsync());
  const button = [...host.querySelectorAll('button')].find(
    (entry) => entry.textContent === 'Inventario',
  )!;
  await act(async () => button.click());
  await act(async () => vi.runAllTimersAsync());
  expect(host.textContent).toContain('Sin valorar');
  expect(host.textContent).not.toContain('$ 0');
});
