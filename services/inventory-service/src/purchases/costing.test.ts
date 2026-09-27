/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../prisma.service';
import { StockService } from './stock.service';

type Balance = {
  quantity: Prisma.Decimal;
  inventoryValue: Prisma.Decimal | null;
  averageUnitCost: Prisma.Decimal | null;
};

function harness(
  initial: Record<
    string,
    { quantity: string; value: string | null; average: string | null }
  > = {},
) {
  const balances = new Map<string, Balance>();
  for (const [id, value] of Object.entries(initial))
    balances.set(id, {
      quantity: new Prisma.Decimal(value.quantity),
      inventoryValue:
        value.value === null ? null : new Prisma.Decimal(value.value),
      averageUnitCost:
        value.average === null ? null : new Prisma.Decimal(value.average),
    });
  const tx = {
    inventoryBalance: {
      upsert: vi.fn(async ({ where, create }: any) => {
        if (!balances.has(where.itemId))
          balances.set(where.itemId, {
            quantity: new Prisma.Decimal(create.quantity),
            inventoryValue: new Prisma.Decimal(create.inventoryValue),
            averageUnitCost: null,
          });
        return balances.get(where.itemId)!;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const next = {
          quantity: new Prisma.Decimal(data.quantity),
          inventoryValue:
            data.inventoryValue === null
              ? null
              : new Prisma.Decimal(data.inventoryValue),
          averageUnitCost:
            data.averageUnitCost === null
              ? null
              : new Prisma.Decimal(data.averageUnitCost),
        };
        balances.set(where.itemId, next);
        return next;
      }),
    },
    inventoryMovement: {
      create: vi.fn(async ({ data }: any) => ({
        id: randomUUID(),
        purchaseLineId: null,
        purchaseLine: null,
        reversesId: data.reversesId ?? null,
        operationId: data.operationId ?? null,
        productionOperationId: data.productionOperationId ?? null,
        saleOperationId: data.saleOperationId ?? null,
        occurredAt: new Date('2026-09-26T12:00:00.000Z'),
        createdAt: new Date('2026-09-26T12:00:00.000Z'),
        item: { id: data.itemId, sku: 'TEST', name: 'Prueba' },
        ...data,
        quantity: new Prisma.Decimal(data.quantity),
        unitCost:
          data.unitCost === null ? null : new Prisma.Decimal(data.unitCost),
        totalCost:
          data.totalCost === null ? null : new Prisma.Decimal(data.totalCost),
        inventoryValueAfter:
          data.inventoryValueAfter === null
            ? null
            : new Prisma.Decimal(data.inventoryValueAfter),
        averageUnitCostAfter:
          data.averageUnitCostAfter === null
            ? null
            : new Prisma.Decimal(data.averageUnitCostAfter),
      })),
    },
  };
  return { balances, tx, service: new StockService({} as PrismaService) };
}

const entry = (
  itemId: string,
  type: any,
  quantity: string,
  totalCost?: string,
) => ({
  itemId,
  baseUnit: 'MILLILITER' as const,
  type,
  quantity,
  origin: 'PRODUCTION' as const,
  reference: randomUUID(),
  reason: 'Prueba de costeo',
  actorId: randomUUID(),
  totalCost,
});

describe('valoración por promedio ponderado móvil', () => {
  it('valora explícitamente la cantidad preexistente y deja auditoría', async () => {
    const itemId = randomUUID(),
      operationId = randomUUID(),
      actorId = randomUUID();
    const now = new Date('2026-09-26T12:00:00.000Z');
    const tx = {
      initialInventoryValuation: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(async ({ data }: any) => ({
          id: randomUUID(),
          createdAt: now,
          ...data,
          quantity: new Prisma.Decimal(data.quantity),
          unitCost: new Prisma.Decimal(data.unitCost),
          totalCost: new Prisma.Decimal(data.totalCost),
        })),
      },
      inventoryBalance: {
        findUnique: vi.fn().mockResolvedValue({
          quantity: new Prisma.Decimal('5'),
          inventoryValue: null,
        }),
        update: vi.fn(),
      },
      $queryRaw: vi
        .fn()
        .mockResolvedValue([
          { id: itemId, active: true, trackInventory: true },
        ]),
    };
    const db = {
      $transaction: vi.fn(async (work: any) => work(tx)),
    } as unknown as PrismaService;
    const service = new StockService(db);
    const result = await service.initialValuation(
      {
        operationId,
        itemId,
        quantity: '5',
        unitCost: '2.5',
        occurredAt: now.toISOString(),
        reason: 'Apertura de Fase 7',
      },
      actorId,
    );
    expect(result.totalCost).toBe('12.5');
    expect(tx.inventoryBalance.update).toHaveBeenCalledWith({
      where: { itemId },
      data: { inventoryValue: '12.5', averageUnitCost: '2.5' },
    });
    expect(tx.initialInventoryValuation.create).toHaveBeenCalledOnce();
  });

  it('pondera entradas confirmadas sin redondear a centavos', async () => {
    const id = randomUUID();
    const { service, tx, balances } = harness();
    await service.record(tx as any, entry(id, 'PURCHASE_IN', '10', '25000'));
    const second = await service.record(
      tx as any,
      entry(id, 'PURCHASE_IN', '20', '54000'),
    );
    expect(second.totalCost).toBe('54000');
    expect(balances.get(id)!.quantity.toFixed()).toBe('30');
    expect(balances.get(id)!.inventoryValue!.toFixed()).toBe('79000');
    expect(balances.get(id)!.averageUnitCost!.toFixed()).toBe(
      '2633.333333333333333333',
    );
  });

  it('valoriza la salida con el promedio vigente y conserva el promedio', async () => {
    const id = randomUUID();
    const { service, tx, balances } = harness({
      [id]: { quantity: '2500', value: '10000', average: '4' },
    });
    const movement = await service.record(
      tx as any,
      entry(id, 'PRODUCTION_OUT', '800'),
    );
    expect(movement.totalCost).toBe('3200');
    expect(balances.get(id)!.quantity.toFixed()).toBe('1700');
    expect(balances.get(id)!.inventoryValue!.toFixed()).toBe('6800');
    expect(balances.get(id)!.averageUnitCost!.toFixed()).toBe('4');
  });

  it('reintegra el costo histórico exacto mediante movimiento compensatorio', async () => {
    const id = randomUUID();
    const { service, tx, balances } = harness({
      [id]: { quantity: '10', value: '100', average: '10' },
    });
    const consumed = await service.record(
      tx as any,
      entry(id, 'SALE_OUT', '4'),
    );
    await service.record(
      tx as any,
      entry(id, 'SALE_RETURN', '4', consumed.totalCost!),
    );
    expect(balances.get(id)!.quantity.toFixed()).toBe('10');
    expect(balances.get(id)!.inventoryValue!.toFixed()).toBe('100');
    expect(tx.inventoryMovement.create).toHaveBeenCalledTimes(2);
  });

  it('transfiere granel y empaques al producto terminado sin mezclar componentes', async () => {
    const bulk = randomUUID(),
      cup = randomUUID(),
      lid = randomUUID(),
      label = randomUUID(),
      output = randomUUID();
    const { service, tx, balances } = harness({
      [bulk]: {
        quantity: '7000',
        value: '58000',
        average: '8.285714285714285714',
      },
      [cup]: { quantity: '10', value: '3500', average: '350' },
      [lid]: { quantity: '10', value: '1000', average: '100' },
      [label]: { quantity: '10', value: '800', average: '80' },
    });
    // 220 ml netos + 10 ml de merma normal de envasado.
    const bulkOut = await service.record(
      tx as any,
      entry(bulk, 'PRODUCTION_OUT', '230'),
    );
    const packageCosts = [];
    for (const [id] of [[cup], [lid], [label]] as const)
      packageCosts.push(
        await service.record(tx as any, {
          ...entry(id, 'PACKAGING_OUT', '1'),
          baseUnit: 'UNIT',
        }),
      );
    const Exact = Prisma.Decimal.clone({ precision: 80 });
    const total = packageCosts.reduce(
      (sum, movement) => sum.plus(movement.totalCost!),
      new Exact(bulkOut.totalCost!),
    );
    const finished = await service.record(tx as any, {
      ...entry(output, 'PACKAGED_PRODUCT_IN', '1', total.toFixed()),
      baseUnit: 'UNIT',
    });
    expect(bulkOut.totalCost).toBe('1905.71428571428571422');
    expect(finished.totalCost).toBe('2435.71428571428571422');
    expect(balances.get(output)!.averageUnitCost!.toFixed()).toBe(
      '2435.71428571428571422',
    );
  });

  it('rechaza consumos económicos de existencias preexistentes sin valoración', async () => {
    const id = randomUUID();
    const { service, tx } = harness({
      [id]: { quantity: '5', value: null, average: null },
    });
    await expect(
      service.record(tx as any, entry(id, 'SALE_OUT', '1')),
    ).rejects.toMatchObject({ status: 409 });
    expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
  });
});
