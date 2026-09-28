import { describe, expect, it } from 'vitest';
import { ReportingService } from './reporting.service';
import type { PrismaService } from '../prisma.service';

type Row = Record<string, unknown> & {
  sourceEntityId: string;
  sourceVersion: bigint;
  occurredAt: Date;
};
class MemoryModel {
  rows = new Map<string, Row>();
  async findUnique({ where }: { where: Record<string, string> }) {
    const key = where.sourceEntityId ?? where.eventId;
    return this.rows.get(key) ?? null;
  }
  async upsert({
    where,
    create,
    update,
  }: {
    where: { sourceEntityId: string };
    create: Row;
    update: Row;
  }) {
    const value = this.rows.has(where.sourceEntityId) ? update : create;
    this.rows.set(where.sourceEntityId, value);
    return value;
  }
  async deleteMany() {
    const count = this.rows.size;
    this.rows.clear();
    return { count };
  }
}
class MemoryDb {
  reportInventoryItem = new MemoryModel();
  reportInventoryMovement = new MemoryModel();
  reportPurchaseItem = new MemoryModel();
  reportProductionBatch = new MemoryModel();
  reportPackagingOperation = new MemoryModel();
  reportSaleMargin = new MemoryModel();
  events = new Map<string, Row>();
  reportProcessedEvent = {
    findUnique: async ({ where }: { where: { eventId: string } }) =>
      this.events.get(where.eventId) ?? null,
    create: async ({ data }: { data: Row & { eventId: string } }) => {
      this.events.set(data.eventId, data);
      return data;
    },
    deleteMany: async () => {
      const count = this.events.size;
      this.events.clear();
      return { count };
    },
  };
  async $transaction<T>(value: (tx: MemoryDb) => Promise<T>) {
    return value(this);
  }
}

const uuid = (last: string) =>
  `00000000-0000-4000-8000-${last.padStart(12, '0')}`;
const base = (event: number, entity: number, version: number) => ({
  eventId: uuid(String(event)),
  sourceEntityId: uuid(String(entity)),
  sourceVersion: version,
  operationId: uuid('900'),
  occurredAt: `2026-09-27T12:00:0${version}.000Z`,
});
const inventory = (event: number, version: number, name: string) => ({
  ...base(event, 10, version),
  kind: 'ITEM_SNAPSHOT',
  sourceService: 'inventory-service',
  itemId: uuid('10'),
  itemNameSnapshot: name,
  itemType: 'RAW_MATERIAL',
  unit: 'GRAM',
  onHand: '5',
  valuationStatus: 'UNVALUED',
  weightedAverageCost: null,
  inventoryValue: null,
  active: true,
  updatedAt: `2026-09-27T12:00:0${version}.000Z`,
});

describe('proyecciones Reporting', () => {
  it('deduplica eventId y operationId no crea otra entidad', async () => {
    const db = new MemoryDb();
    const service = new ReportingService(db as unknown as PrismaService);
    const value = inventory(1, 1, 'Leche');
    expect(await service.apply('inventory.reporting.v1', value)).toBe(
      'applied',
    );
    expect(await service.apply('inventory.reporting.v1', value)).toBe(
      'duplicate',
    );
    expect(db.reportInventoryItem.rows.size).toBe(1);
  });
  it('un evento antiguo recibido después no sobrescribe el nuevo', async () => {
    const db = new MemoryDb();
    const service = new ReportingService(db as unknown as PrismaService);
    await service.apply(
      'inventory.reporting.v1',
      inventory(2, 2, 'Leche nueva'),
    );
    expect(
      await service.apply(
        'inventory.reporting.v1',
        inventory(3, 1, 'Leche antigua'),
      ),
    ).toBe('stale');
    expect(db.reportInventoryItem.rows.get(uuid('10'))?.itemNameSnapshot).toBe(
      'Leche nueva',
    );
  });
  it('proyecta movimiento con saldo histórico ausente explícito', async () => {
    const db = new MemoryDb();
    const service = new ReportingService(db as unknown as PrismaService);
    expect(
      await service.apply('inventory.reporting.v1', {
        ...base(4, 20, 1),
        kind: 'MOVEMENT',
        sourceService: 'inventory-service',
        movementId: uuid('20'),
        itemId: uuid('10'),
        itemNameSnapshot: 'Leche',
        movementType: 'PURCHASE_IN',
        reference: 'C-1',
        quantityIn: '5',
        quantityOut: '0',
        balanceAfter: null,
        unitCost: '2',
        totalCost: '10',
        averageCostAfter: '2',
      }),
    ).toBe('applied');
    expect(
      db.reportInventoryMovement.rows.get(uuid('20'))?.balanceAfter,
    ).toBeNull();
  });
  it('proyecta Production sin inventar nombre ni costos', async () => {
    const db = new MemoryDb();
    const service = new ReportingService(db as unknown as PrismaService);
    await service.apply('production.reporting.v1', {
      ...base(5, 30, 1),
      kind: 'BATCH_SNAPSHOT',
      sourceService: 'production-service',
      batchId: uuid('30'),
      batch: 'L-30',
      productId: uuid('31'),
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
    expect(
      db.reportProductionBatch.rows.get(uuid('30'))?.accumulatedCost,
    ).toBeNull();
  });
  it('conserva COGS y margen históricos ante un snapshot de Inventory', async () => {
    const db = new MemoryDb();
    const service = new ReportingService(db as unknown as PrismaService);
    await service.apply('finance.reporting.v1', {
      ...base(6, 40, 1),
      kind: 'SALE_MARGIN_SNAPSHOT',
      sourceService: 'finance-reporting-service',
      saleId: uuid('41'),
      saleLineId: uuid('40'),
      status: 'CONFIRMED',
      productId: uuid('10'),
      productNameSnapshot: 'Yogurt',
      quantity: '2',
      revenue: '20000',
      cogs: '8000',
      grossMargin: '12000',
      grossMarginPercent: '60',
    });
    await service.apply(
      'inventory.reporting.v1',
      inventory(7, 3, 'Leche con costo nuevo'),
    );
    expect(db.reportSaleMargin.rows.get(uuid('40'))?.cogs).toBe('8000');
    expect(db.reportSaleMargin.rows.get(uuid('40'))?.grossMargin).toBe('12000');
  });
  it('reconstrucción limpia únicamente proyecciones derivadas de Inventory', async () => {
    const db = new MemoryDb();
    const service = new ReportingService(db as unknown as PrismaService);
    await service.apply('inventory.reporting.v1', inventory(8, 1, 'Leche'));
    db.reportSaleMargin.rows.set(uuid('50'), {
      sourceEntityId: uuid('50'),
      sourceVersion: 1n,
      occurredAt: new Date(),
    });
    const result = await service.clearInventory();
    expect(result.items).toBe(1);
    expect(result.purchases).toBe(0);
    expect(db.reportInventoryItem.rows.size).toBe(0);
    expect(db.reportSaleMargin.rows.size).toBe(1);
  });
});
