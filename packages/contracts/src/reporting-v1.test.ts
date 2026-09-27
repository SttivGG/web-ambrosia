import { describe, expect, it } from 'vitest';
import {
  financeReportingEventV1Schema,
  inventoryReportingEventV1Schema,
  productionReportingEventV1Schema,
  reportInventoryItemSnapshotV1Schema,
  reportInventoryFiltersV1Schema,
} from './reporting-v1';

const ids = {
  eventId: '00000000-0000-4000-8000-000000000001',
  sourceEntityId: '00000000-0000-4000-8000-000000000002',
  operationId: '00000000-0000-4000-8000-000000000003',
};
const metadata = {
  ...ids,
  sourceVersion: 1,
  occurredAt: '2026-09-27T12:00:00.000Z',
};

describe('contratos Reporting v1', () => {
  it('acepta snapshot Inventory Decimal como texto', () => {
    const value = reportInventoryItemSnapshotV1Schema.parse({
      ...metadata,
      kind: 'ITEM_SNAPSHOT',
      sourceService: 'inventory-service',
      itemId: ids.sourceEntityId,
      itemNameSnapshot: 'Leche',
      itemType: 'RAW_MATERIAL',
      unit: 'MILLILITER',
      onHand: '10.25',
      valuationStatus: 'VALUED',
      weightedAverageCost: '2.123456789012345678',
      inventoryValue: '21.7654321',
      active: true,
      updatedAt: metadata.occurredAt,
    });
    expect(value.onHand).toBe('10.25');
  });
  it('rechaza UNVALUED con costo fabricado', () => {
    expect(() =>
      inventoryReportingEventV1Schema.parse({
        ...metadata,
        kind: 'ITEM_SNAPSHOT',
        sourceService: 'inventory-service',
        itemId: ids.sourceEntityId,
        itemNameSnapshot: 'Leche',
        itemType: 'RAW_MATERIAL',
        unit: 'MILLILITER',
        onHand: '10',
        valuationStatus: 'UNVALUED',
        weightedAverageCost: '1',
        inventoryValue: null,
        active: true,
        updatedAt: metadata.occurredAt,
      }),
    ).toThrow();
  });
  it('rechaza números JS y versiones incompatibles', () => {
    expect(() =>
      financeReportingEventV1Schema.parse({
        ...metadata,
        sourceVersion: -1,
        kind: 'SALE_MARGIN_SNAPSHOT',
        sourceService: 'finance-reporting-service',
        saleId: ids.sourceEntityId,
        saleLineId: ids.eventId,
        status: 'CONFIRMED',
        productId: ids.operationId,
        productNameSnapshot: 'Yogurt',
        quantity: '1',
        revenue: 12000,
        cogs: '5000',
        grossMargin: '7000',
        grossMarginPercent: '58.3333333333',
      }),
    ).toThrow();
  });
  it('acepta ausencia explícita de costos de Production', () => {
    const value = productionReportingEventV1Schema.parse({
      ...metadata,
      kind: 'BATCH_SNAPSHOT',
      sourceService: 'production-service',
      batchId: ids.sourceEntityId,
      batch: 'L-1',
      productId: ids.operationId,
      productNameSnapshot: null,
      status: 'DRAFT',
      startedAt: null,
      completedAt: null,
      inputQuantity: '10',
      outputQuantity: null,
      yieldPercentage: null,
      wasteQuantity: null,
      accumulatedCost: null,
      sellableCost: null,
      packagingOutputQuantity: null,
    });
    expect(value.accumulatedCost).toBeNull();
  });
  it('aplica rango temporal [from, to) y límite de página', () => {
    expect(() =>
      reportInventoryFiltersV1Schema.parse({
        page: '1',
        pageSize: '101',
        from: metadata.occurredAt,
        to: metadata.occurredAt,
      }),
    ).toThrow();
    expect(
      reportInventoryFiltersV1Schema.parse({
        page: '1',
        pageSize: '100',
        from: metadata.occurredAt,
        to: '2026-09-28T12:00:00.000Z',
      }).pageSize,
    ).toBe(100);
  });
});
