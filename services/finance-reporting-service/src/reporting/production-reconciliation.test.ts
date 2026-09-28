import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReportingService } from './reporting.service';
import { ProductionReconciliationService } from './production-reconciliation.service';
const batch = {
  kind: 'BATCH_SNAPSHOT',
  sourceService: 'production-service',
  eventId: '00000000-0000-4000-8000-000000000001',
  sourceEntityId: '00000000-0000-4000-8000-000000000002',
  sourceVersion: 1,
  operationId: null,
  occurredAt: '2026-09-28T12:00:00.000Z',
  batchId: '00000000-0000-4000-8000-000000000002',
  batch: 'L-1',
  productId: '00000000-0000-4000-8000-000000000003',
  productNameSnapshot: null,
  status: 'COMPLETED',
  startedAt: null,
  completedAt: '2026-09-28T12:00:00.000Z',
  inputQuantity: '10',
  outputQuantity: '8',
  yieldPercentage: '80',
  wasteQuantity: '2',
  accumulatedCost: '100',
  sellableCost: '120',
  packagingOutputQuantity: '4',
};
describe('reconciliación de Production', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.REPORTING_PRODUCTION_TOKEN;
  });
  it('es repetible y rebuild solo limpia derivados de Production', async () => {
    process.env.REPORTING_PRODUCTION_TOKEN = 'x'.repeat(96);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          batches: [batch],
          packaging: [],
          pagination: { page: 1, pageSize: 100, totalItems: 1, totalPages: 1 },
        }),
      })),
    );
    let seen = false;
    const reporting = {
      apply: vi.fn(async () =>
        seen ? ('duplicate' as const) : ((seen = true), 'applied' as const),
      ),
      clearProduction: vi.fn(async () => ({ batches: 1, packaging: 0 })),
    } as unknown as ReportingService;
    const service = new ProductionReconciliationService(reporting);
    await expect(service.reconcile()).resolves.toMatchObject({ applied: 1 });
    await expect(service.reconcile()).resolves.toMatchObject({ duplicates: 1 });
    await expect(service.rebuild()).resolves.toMatchObject({
      cleared: { batches: 1, packaging: 0 },
    });
  });
});
