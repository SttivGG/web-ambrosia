import { afterEach, describe, expect, it, vi } from 'vitest';
import { InventoryReconciliationService } from './reconciliation.service';
import type { ReportingService } from './reporting.service';

const event = {
  kind: 'ITEM_SNAPSHOT',
  sourceService: 'inventory-service',
  sourceEntityId: '00000000-0000-4000-8000-000000000001',
  sourceVersion: 1,
  operationId: null,
  eventId: '00000000-0000-4000-8000-000000000002',
  occurredAt: '2026-09-27T12:00:00.000Z',
  itemId: '00000000-0000-4000-8000-000000000001',
  itemNameSnapshot: 'Leche',
  itemType: 'RAW_MATERIAL',
  unit: 'MILLILITER',
  onHand: '10',
  valuationStatus: 'UNVALUED',
  weightedAverageCost: null,
  inventoryValue: null,
  active: true,
  updatedAt: '2026-09-27T12:00:00.000Z',
};

describe('reconciliación de Inventory', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.FINANCE_INVENTORY_TOKEN;
  });
  it('recupera un read model ausente y una segunda ejecución no duplica', async () => {
    process.env.FINANCE_INVENTORY_TOKEN = 'x'.repeat(64);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          items: [event],
          movements: [],
          purchases: [],
          pagination: { page: 1, pageSize: 100, totalItems: 1, totalPages: 1 },
        }),
      })),
    );
    let seen = false;
    const reporting = {
      apply: vi.fn(async () => {
        if (seen) return 'duplicate' as const;
        seen = true;
        return 'applied' as const;
      }),
      clearInventory: vi.fn(async () => ({
        items: 1,
        movements: 0,
        purchases: 0,
      })),
    } as unknown as ReportingService;
    const service = new InventoryReconciliationService(reporting);
    await expect(service.reconcile()).resolves.toMatchObject({ applied: 1 });
    await expect(service.reconcile()).resolves.toMatchObject({ duplicates: 1 });
  });
  it('rebuild limpia solo derivados y vuelve a reconciliar', async () => {
    process.env.FINANCE_INVENTORY_TOKEN = 'x'.repeat(64);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          items: [event],
          movements: [],
          purchases: [],
          pagination: { page: 1, pageSize: 100, totalItems: 1, totalPages: 1 },
        }),
      })),
    );
    const reporting = {
      apply: vi.fn(async () => 'applied' as const),
      clearInventory: vi.fn(async () => ({
        items: 1,
        movements: 2,
        purchases: 0,
      })),
    } as unknown as ReportingService;
    const service = new InventoryReconciliationService(reporting);
    const result = await service.rebuild();
    expect(result.cleared).toEqual({ items: 1, movements: 2, purchases: 0 });
    expect(result.reconciled.applied).toBe(1);
  });
});
