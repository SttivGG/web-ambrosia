import { describe, expect, it } from 'vitest';
import { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../prisma.service';
import { OperationalReportsService } from './operational.service';

const d = (value: string | number) => new Prisma.Decimal(value);
const date = new Date('2026-09-28T12:00:00.000Z');
const purchases = [
  {
    sourceService: 'inventory-service',
    sourceEntityId: '00000000-0000-4000-8000-000000000001',
    sourceVersion: 1n,
    operationId: null,
    eventId: '00000000-0000-4000-8000-000000000002',
    occurredAt: date,
    processedAt: date,
    purchaseId: '00000000-0000-4000-8000-000000000003',
    purchaseLineId: '00000000-0000-4000-8000-000000000001',
    purchaseReference: 'C-1',
    purchasedAt: date,
    supplierId: '00000000-0000-4000-8000-000000000004',
    supplierNameSnapshot: 'Proveedor',
    itemId: '00000000-0000-4000-8000-000000000005',
    itemNameSnapshot: 'Leche',
    categoryId: '00000000-0000-4000-8000-000000000006',
    categoryNameSnapshot: 'Lácteos',
    quantity: d(10),
    unit: 'GRAM',
    unitCost: d(2),
    subtotal: d(20),
    status: 'RECEIVED',
  },
  {
    sourceService: 'inventory-service',
    sourceEntityId: '00000000-0000-4000-8000-000000000007',
    sourceVersion: 1n,
    operationId: null,
    eventId: '00000000-0000-4000-8000-000000000008',
    occurredAt: date,
    processedAt: date,
    purchaseId: '00000000-0000-4000-8000-000000000009',
    purchaseLineId: '00000000-0000-4000-8000-000000000007',
    purchaseReference: 'C-2',
    purchasedAt: date,
    supplierId: '00000000-0000-4000-8000-000000000004',
    supplierNameSnapshot: 'Proveedor',
    itemId: '00000000-0000-4000-8000-000000000005',
    itemNameSnapshot: 'Leche',
    categoryId: '00000000-0000-4000-8000-000000000006',
    categoryNameSnapshot: 'Lácteos',
    quantity: d(30),
    unit: 'GRAM',
    unitCost: d(4),
    subtotal: d(120),
    status: 'RECEIVED',
  },
];
const batches = [
  {
    sourceService: 'production-service',
    sourceEntityId: '00000000-0000-4000-8000-000000000010',
    sourceVersion: 1n,
    operationId: null,
    eventId: '00000000-0000-4000-8000-000000000011',
    occurredAt: date,
    processedAt: date,
    batchId: '00000000-0000-4000-8000-000000000010',
    batch: 'L-1',
    productId: '00000000-0000-4000-8000-000000000012',
    productNameSnapshot: null,
    status: 'COMPLETED',
    startedAt: date,
    completedAt: date,
    inputQuantity: d(0),
    outputQuantity: d(0),
    yieldPercentage: d(0),
    wasteQuantity: d(0),
    accumulatedCost: d(10),
    sellableCost: d(10),
    packagingOutputQuantity: d(1),
  },
  {
    sourceService: 'production-service',
    sourceEntityId: '00000000-0000-4000-8000-000000000013',
    sourceVersion: 1n,
    operationId: null,
    eventId: '00000000-0000-4000-8000-000000000014',
    occurredAt: date,
    processedAt: date,
    batchId: '00000000-0000-4000-8000-000000000013',
    batch: 'L-2',
    productId: '00000000-0000-4000-8000-000000000012',
    productNameSnapshot: null,
    status: 'COMPLETED',
    startedAt: date,
    completedAt: date,
    inputQuantity: d(10),
    outputQuantity: d(8),
    yieldPercentage: d(80),
    wasteQuantity: d(2),
    accumulatedCost: d(20),
    sellableCost: d(20),
    packagingOutputQuantity: d(2),
  },
];
const db = {
  reportPurchaseItem: {
    findMany: async () => purchases,
    count: async () => purchases.length,
  },
  reportProductionBatch: {
    findMany: async () => batches,
    count: async () => batches.length,
  },
  reportPackagingOperation: { findMany: async () => [], count: async () => 0 },
  $transaction: async (values: Promise<unknown>[]) => Promise.all(values),
} as unknown as PrismaService;
const service = new OperationalReportsService(db);
const paging = { page: 1, pageSize: 20 };

describe('reportes operativos', () => {
  it('calcula costo promedio ponderado y no promedio simple', async () => {
    const summary = await service.purchaseSummary(paging, true);
    expect(summary.metrics).toMatchObject({
      totalComprado: '140',
      numeroCompras: 2,
      proveedores: 1,
      costoPromedioPonderado: '3.5',
    });
  });
  it('consolida proveedor, última compra y evolución de precios', async () => {
    const result = await service.suppliers(paging, true);
    expect(result.data[0]).toMatchObject({
      purchaseCount: 2,
      suppliedItems: 1,
      totalPurchases: '140',
    });
    expect(result.data[0]!.averageCosts[0]!.weightedAverageCost).toBe('3.5');
    expect(result.data[0]!.priceHistory).toHaveLength(2);
  });
  it('oculta costos sin reports.finance', async () => {
    const result = await service.purchases(paging, false);
    expect(result.data[0]!.unitCost).toBeNull();
    expect(result.data[0]!.subtotal).toBeNull();
  });
  it('calcula producción y rendimiento con Decimal', async () => {
    await expect(
      service.productionSummary(paging, true),
    ).resolves.toMatchObject({
      metrics: {
        lotes: 2,
        cantidadProducida: '8',
        rendimientoPromedio: '40',
        mermaTotal: '2',
        costoAcumulado: '30',
      },
    });
    await expect(service.yieldSummary(paging)).resolves.toMatchObject({
      metrics: { promedio: '40', minimo: '0', maximo: '80', lotes: 2 },
    });
  });
  it('evita división por cero en porcentaje de merma', async () => {
    const result = await service.wasteSummary(paging);
    expect(result.metrics).toMatchObject({
      mermaTotal: '2',
      mermaPromedioPorcentual: '20',
      lotesAnalizados: 2,
    });
  });
});
