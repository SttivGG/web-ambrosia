import { describe, expect, it } from 'vitest';
import {
  inventoryReportingEventV1Schema,
  productionReportingEventV1Schema,
  reportMovementFiltersV1Schema,
} from './reporting-v1';
const meta = {
  eventId: '00000000-0000-4000-8000-000000000001',
  sourceEntityId: '00000000-0000-4000-8000-000000000002',
  sourceVersion: 1,
  operationId: null,
  occurredAt: '2026-09-28T12:00:00.000Z',
};
describe('contratos operativos Reporting v1', () => {
  it('acepta compra Decimal con snapshots de proveedor y categoría', () => {
    expect(
      inventoryReportingEventV1Schema.parse({
        ...meta,
        kind: 'PURCHASE_ITEM_SNAPSHOT',
        sourceService: 'inventory-service',
        purchaseId: '00000000-0000-4000-8000-000000000003',
        purchaseLineId: meta.sourceEntityId,
        purchaseReference: 'C-1',
        purchasedAt: meta.occurredAt,
        supplierId: '00000000-0000-4000-8000-000000000004',
        supplierNameSnapshot: 'Proveedor',
        itemId: '00000000-0000-4000-8000-000000000005',
        itemNameSnapshot: 'Leche',
        categoryId: '00000000-0000-4000-8000-000000000006',
        categoryNameSnapshot: 'Lácteos',
        quantity: '10.5',
        unit: 'GRAM',
        unitCost: '1200.25',
        subtotal: '12602.625',
        status: 'RECEIVED',
      }).kind,
    ).toBe('PURCHASE_ITEM_SNAPSHOT');
  });
  it('preserva componentes separados de costo de envasado', () => {
    const value = productionReportingEventV1Schema.parse({
      ...meta,
      kind: 'PACKAGING_SNAPSHOT',
      sourceService: 'production-service',
      packagingOperationId: meta.sourceEntityId,
      batchId: '00000000-0000-4000-8000-000000000003',
      batch: 'L-1',
      finishedProductId: '00000000-0000-4000-8000-000000000004',
      units: '10',
      netContentPerUnit: '150',
      netContentTotal: '1500',
      unit: 'GRAM',
      bulkCost: '1000',
      materialsCost: '500',
      totalCost: '1500',
      finishedUnitCost: '150',
      status: 'CONFIRMED',
      packagedAt: meta.occurredAt,
    });
    expect(value).toMatchObject({
      bulkCost: '1000',
      materialsCost: '500',
      totalCost: '1500',
    });
  });
  it('valida filtros de referencia y operationId con rango semiabierto', () => {
    expect(
      reportMovementFiltersV1Schema.parse({
        page: 1,
        pageSize: 20,
        reference: 'L-1',
        operationId: '00000000-0000-4000-8000-000000000004',
        from: '2026-09-01T00:00:00.000Z',
        to: '2026-10-01T00:00:00.000Z',
      }).reference,
    ).toBe('L-1');
  });
});
