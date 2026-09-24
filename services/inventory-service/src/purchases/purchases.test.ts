import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createPurchaseV1Schema,
  updatePurchaseV1Schema,
  adjustmentV1Schema,
  purchaseFiltersV1Schema,
  movementFiltersV1Schema,
  stockFiltersV1Schema,
} from '@ambrosia/contracts';
import {
  amounts,
  draft,
  version,
  databaseError,
  PurchaseError,
} from './domain';
import { PurchasesService } from './purchases.service';
import { StockService } from './stock.service';
import { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../prisma.service';
const itemId = randomUUID(),
  supplierId = randomUUID();
const valid = {
  supplierId,
  reference: ' REF-01 ',
  purchasedAt: '2026-09-22T12:00:00.000Z',
  lines: [{ itemId, quantity: '2.5', unitCost: '100.01' }],
};
describe('Contratos compras y existencias', () => {
  it('normaliza referencia y admite compra válida', () =>
    expect(createPurchaseV1Schema.parse(valid).reference).toBe('REF-01'));
  it.each(['0', '-1', '1e3', 'NaN', '01', '0.00000000001', '100000000000000'])(
    'rechaza cantidad %s',
    (quantity) =>
      expect(
        createPurchaseV1Schema.safeParse({
          ...valid,
          lines: [{ ...valid.lines[0], quantity }],
        }).success,
      ).toBe(false),
  );
  it.each(['-1', '1e2', '0.001', '10000000000000000000000', 'NaN'])(
    'rechaza costo %s',
    (unitCost) =>
      expect(
        createPurchaseV1Schema.safeParse({
          ...valid,
          lines: [{ ...valid.lines[0], unitCost }],
        }).success,
      ).toBe(false),
  );
  it.each([
    [],
    [valid.lines[0], valid.lines[0]],
    Array.from({ length: 51 }, () => ({
      ...valid.lines[0],
      itemId: randomUUID(),
    })),
  ])('rechaza líneas vacías, repetidas o excesivas', (lines) =>
    expect(createPurchaseV1Schema.safeParse({ ...valid, lines }).success).toBe(
      false,
    ),
  );
  it.each([
    { total: '1' },
    { currency: 'USD' },
    { status: 'RECEIVED' },
    { supplierId: 'bad' },
    { purchasedAt: '2026-09-22' },
    { lines: [{ ...valid.lines[0], itemId: 'bad' }] },
  ])('rechaza entrada inválida %j', (fields) =>
    expect(
      createPurchaseV1Schema.safeParse({ ...valid, ...fields }).success,
    ).toBe(false),
  );
  it('exige versión y documento completo al editar', () => {
    expect(updatePurchaseV1Schema.safeParse(valid).success).toBe(false);
    expect(
      updatePurchaseV1Schema.safeParse({ ...valid, expectedVersion: 1 })
        .success,
    ).toBe(true);
  });
  it.each([
    purchaseFiltersV1Schema,
    movementFiltersV1Schema,
    stockFiltersV1Schema,
  ])('pagina y rechaza páginas ilimitadas', (schema) => {
    expect(schema.parse({})).toMatchObject({ page: 1, pageSize: 20 });
    expect(schema.safeParse({ pageSize: '101' }).success).toBe(false);
  });
  it('rechaza rango invertido', () =>
    expect(
      movementFiltersV1Schema.safeParse({
        from: '2026-09-22T00:00:00Z',
        to: '2026-09-21T00:00:00Z',
      }).success,
    ).toBe(false));
  it('ajuste exige motivo y clave de operación', () => {
    const a = {
      itemId,
      type: 'ADJUSTMENT_OUT',
      quantity: '1',
      operationId: randomUUID(),
      reason: 'Conteo físico',
    };
    expect(adjustmentV1Schema.safeParse(a).success).toBe(true);
    expect(adjustmentV1Schema.safeParse({ ...a, reason: '' }).success).toBe(
      false,
    );
    expect(
      adjustmentV1Schema.safeParse({ ...a, operationId: undefined }).success,
    ).toBe(false);
  });
});
describe('Importes e invariantes', () => {
  it('redondea HALF_UP cada línea antes de sumar', () =>
    expect(
      amounts([
        { itemId, quantity: '2.5', unitCost: '100.01' },
        { itemId: randomUUID(), quantity: '0.5', unitCost: '0.01' },
      ]).total,
    ).toBe('250.04'));
  it('conserva dígitos por encima de Number.MAX_SAFE_INTEGER', () =>
    expect(
      amounts([{ itemId, quantity: '1', unitCost: '9007199254740993.01' }])
        .total,
    ).toBe('9007199254740993.01'));
  it('admite costo cero', () =>
    expect(amounts([{ itemId, quantity: '1', unitCost: '0' }]).total).toBe(
      '0.00',
    ));
  it('rechaza desbordamiento de total', () =>
    expect(() =>
      amounts([
        { itemId, quantity: '2', unitCost: '9999999999999999999999.99' },
      ]),
    ).toThrow(PurchaseError));
  it.each(['RECEIVED', 'CANCELLED'])('rechaza edición y recepción de %s', (s) =>
    expect(() => draft(s)).toThrow(PurchaseError),
  );
  it('rechaza versión obsoleta', () => {
    expect(() => version(2, 1)).toThrow(PurchaseError);
    expect(() => version(2, 2)).not.toThrow();
  });
  it.each(['P2034', 'P2025', 'P2002'])('traduce conflicto SQL %s', (code) => {
    try {
      databaseError(
        new Prisma.PrismaClientKnownRequestError('safe', {
          code,
          clientVersion: '7',
        }),
      );
    } catch (e) {
      expect((e as PurchaseError).getStatus()).toBe(409);
    }
  });
  it('sanitiza errores inesperados', () => {
    try {
      databaseError(new Error('secret'));
    } catch (e) {
      expect((e as PurchaseError).getResponse()).not.toContain('secret');
      expect((e as PurchaseError).getStatus()).toBe(500);
    }
  });
});
describe('Servicios (dobles unitarios)', () => {
  const setup = () => {
    const tx = {
      supplier: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ active: true, items: [{ itemId }] }),
      },
      purchase: { findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
      inventoryBalance: {
        upsert: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      inventoryMovement: { findUnique: vi.fn(), create: vi.fn() },
      $queryRaw: vi.fn().mockResolvedValue([
        {
          id: itemId,
          active: true,
          trackInventory: true,
          inventoryBaseUnit: 'UNIT',
        },
      ]),
    };
    const db = {
      $transaction: vi.fn(async (work: (t: unknown) => unknown) => work(tx)),
    };
    const stock = new StockService(db as unknown as PrismaService);
    return {
      tx,
      db,
      stock,
      service: new PurchasesService(db as unknown as PrismaService, stock),
    };
  };
  it('crea borrador con totales del servidor y serializa detalle sin campos internos', async () => {
    const { tx, service } = setup();
    const id = randomUUID(),
      now = new Date();
    tx.purchase.create.mockResolvedValue({
      id,
      supplierId,
      reference: 'REF-01',
      purchasedAt: now,
      status: 'DRAFT',
      notes: null,
      subtotal: new Prisma.Decimal('250.03'),
      total: new Prisma.Decimal('250.03'),
      currency: 'COP',
      version: 1,
      receivedAt: null,
      cancelledAt: null,
      cancellationReason: null,
      createdAt: now,
      updatedAt: now,
      supplier: { id: supplierId, code: 'PROV', name: 'Proveedor' },
      lines: [
        {
          id: randomUUID(),
          purchaseId: id,
          itemId,
          quantity: new Prisma.Decimal('2.5'),
          unitCost: new Prisma.Decimal('100.01'),
          subtotal: new Prisma.Decimal('250.03'),
          baseUnit: 'UNIT',
          item: { id: itemId, sku: 'ART', name: 'Artículo' },
        },
      ],
    });
    const result = await service.create(valid);
    expect(result.total).toBe('250.03');
    expect(result.lines[0]).not.toHaveProperty('purchaseId');
    expect(tx.purchase.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ subtotal: '250.03', total: '250.03' }),
      }),
    );
    expect(tx.inventoryBalance.upsert).not.toHaveBeenCalled();
  });
  it('proveedor inexistente no crea compra', async () => {
    const { tx, service } = setup();
    tx.supplier.findUnique.mockResolvedValue(null);
    await expect(service.create(valid)).rejects.toMatchObject({ status: 404 });
    expect(tx.purchase.create).not.toHaveBeenCalled();
  });
  it('artículo inexistente no crea compra', async () => {
    const { tx, service } = setup();
    tx.$queryRaw.mockResolvedValue([]);
    await expect(service.create(valid)).rejects.toMatchObject({ status: 404 });
  });
  it('exige asociación existente', async () => {
    const { tx, service } = setup();
    tx.supplier.findUnique.mockResolvedValue({ active: true, items: [] });
    await expect(service.create(valid)).rejects.toMatchObject({ status: 409 });
  });
  it('doble recepción se rechaza antes de escribir', async () => {
    const { tx, service } = setup();
    tx.purchase.findUnique.mockResolvedValue({
      version: 2,
      status: 'RECEIVED',
    });
    await expect(
      service.receive(randomUUID(), 2, randomUUID()),
    ).rejects.toMatchObject({ status: 409 });
    expect(tx.purchase.updateMany).not.toHaveBeenCalled();
  });
  it('ajuste no puede sobrepasar saldo; no escribe movimiento', async () => {
    const { tx, stock, db } = setup();
    await expect(
      stock.adjust(
        {
          itemId,
          type: 'ADJUSTMENT_OUT',
          quantity: '8',
          reason: 'Conteo físico',
          operationId: randomUUID(),
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
    expect(db.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: 'Serializable' }),
    );
    expect(tx.inventoryBalance.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { itemId, quantity: { gte: new Prisma.Decimal(8) } },
      }),
    );
  });
  it('clave de ajuste repetida no altera saldo', async () => {
    const { tx, stock } = setup();
    tx.inventoryMovement.findUnique.mockResolvedValue({ id: randomUUID() });
    await expect(
      stock.adjust(
        {
          itemId,
          type: 'ADJUSTMENT_IN',
          quantity: '8',
          reason: 'Conteo físico',
          operationId: randomUUID(),
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(tx.inventoryBalance.upsert).not.toHaveBeenCalled();
  });
});
