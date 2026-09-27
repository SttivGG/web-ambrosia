// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ReportingInfrastructure } from '../components/reporting/reporting';
import { reportingApi } from '../lib/api/reporting';
import { useSession } from '../components/auth/session-provider';

vi.mock('../lib/api/reporting', () => ({
  reportingApi: { health: vi.fn(), inventory: vi.fn() },
}));
vi.mock('../components/auth/session-provider', () => ({ useSession: vi.fn() }));

const health = {
  status: 'ok' as const,
  timestamp: '2026-09-27T12:00:00.000Z',
  projections: {
    inventoryItems: 0,
    inventoryMovements: 0,
    productionBatches: 0,
    saleMargins: 0,
  },
};
const empty = {
  data: [],
  pagination: { page: 1, pageSize: 5, totalItems: 0, totalPages: 0 },
};
let root: Root;
let host: HTMLDivElement;
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
  vi.mocked(reportingApi.inventory).mockResolvedValue(empty);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.clearAllMocks();
  vi.useRealTimers();
});

it('muestra loading y después empty state explícito', async () => {
  await act(async () => root.render(<ReportingInfrastructure />));
  expect(host.querySelector('[role="status"]')?.textContent).toContain(
    'Consultando Reporting',
  );
  await act(async () => vi.runAllTimersAsync());
  expect(host.textContent).toContain('Aún no hay datos proyectados');
});
it('muestra error anunciado y reintento', async () => {
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
it('distingue UNVALUED de cero', async () => {
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
    pagination: { page: 1, pageSize: 5, totalItems: 1, totalPages: 1 },
  });
  await act(async () => root.render(<ReportingInfrastructure />));
  await act(async () => vi.runAllTimersAsync());
  expect(host.textContent).toContain('Sin valorar');
});
