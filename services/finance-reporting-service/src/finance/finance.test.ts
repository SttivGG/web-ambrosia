import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSaleV1Schema,
  moneyAccountV1Schema,
  purchasePaymentInputV1Schema,
} from '@ambrosia/contracts';
import { saleAmounts } from './domain';
import { InventoryClient } from './inventory.client';
import { FinanceService } from './finance.service';
import type { PrismaService } from '../prisma.service';
import { Prisma, type SaleOperation } from '../generated/prisma/client';
const id = '11111111-1111-4111-8111-111111111111';
const saleId = '22222222-2222-4222-8222-222222222222';
const actorId = '33333333-3333-4333-8333-333333333333';
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe('Decimal y contratos financieros', () => {
  it('calcula por línea y redondea HALF_UP sin float', () => {
    expect(
      saleAmounts([{ itemId: id, quantity: '3', unitPrice: '0.10' }]),
    ).toMatchObject({ subtotal: '0.30', total: '0.30' });
    expect(
      saleAmounts([{ itemId: id, quantity: '3', unitPrice: '0.335' } as never])
        .total,
    ).toBe('1.01');
  });
  it.each(['1.5', '1e2', '-1', '0'])(
    'rechaza cantidad de venta %s',
    (quantity) => {
      expect(
        createSaleV1Schema.safeParse({
          operationId: id,
          accountId: saleId,
          paymentMethod: 'CASH',
          occurredAt: new Date().toISOString(),
          lines: [{ itemId: actorId, quantity, unitPrice: '1000' }],
        }).success,
      ).toBe(false);
    },
  );
  it('rechaza importes float/exponente y campos extra', () => {
    expect(
      purchasePaymentInputV1Schema.safeParse({
        operationId: id,
        purchaseId: saleId,
        accountId: actorId,
        amount: '1e3',
        paymentMethod: 'CASH',
        occurredAt: new Date().toISOString(),
        total: '1000',
      }).success,
    ).toBe(false);
  });
  it('admite saldos negativos como Decimal textual', () => {
    expect(
      moneyAccountV1Schema.parse({
        id,
        code: 'CAJA',
        name: 'Caja',
        type: 'CASH',
        description: null,
        active: true,
        currency: 'COP',
        balance: '-9999.90',
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        archivedAt: null,
      }).balance,
    ).toBe('-9999.90');
  });
});
describe('cliente técnico y recuperación', () => {
  it('no llama Inventory sin credencial', async () => {
    vi.stubEnv('FINANCE_INVENTORY_TOKEN', '');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(new InventoryClient().items()).rejects.toThrow(
      'no está configurada',
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it('un fallo de red no se confunde con rechazo definitivo y no envía cookies', async () => {
    vi.stubEnv('FINANCE_INVENTORY_TOKEN', 'a'.repeat(96));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
    await expect(new InventoryClient().items()).rejects.toThrow('no confirmó');
  });
  it('reintenta una respuesta perdida con el mismo operationId', async () => {
    const payload = {
      operationId: id,
      saleId,
      kind: 'CONFIRM' as const,
      actorId,
      reason: 'Venta prueba',
      lines: [{ itemId: actorId, quantity: '1' }],
    };
    const operation = {
      id,
      saleId,
      kind: 'CONFIRM',
      status: 'PENDING',
      payload,
    } as unknown as SaleOperation;
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValue({
        operationId: id,
        saleId,
        status: 'CONFIRMED',
        error: null,
        movements: [],
        totalCost: '400',
        lineCosts: [
          {
            itemId: actorId,
            quantity: '2',
            unitCost: '200',
            totalCost: '400',
          },
        ],
      });
    const tx = {
      saleOperation: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      sale: {
        findUnique: vi.fn().mockResolvedValue({
          id: saleId,
          accountId: id,
          total: new Prisma.Decimal('1000'),
          paymentMethod: 'CASH',
          occurredAt: new Date(),
          reference: null,
          description: null,
          actorId,
          movements: [],
        }),
        update: vi.fn(),
      },
      financeMovement: { create: vi.fn() },
      saleLine: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const db = {
      $transaction: vi.fn(async (fn) => fn(tx)),
    } as unknown as PrismaService;
    const service = new FinanceService(db, {
      execute,
    } as unknown as InventoryClient);
    await expect(service.resolve(operation)).rejects.toThrow('timeout');
    expect(tx.financeMovement.create).not.toHaveBeenCalled();
    await service.resolve(operation);
    expect(execute.mock.calls.map((call) => call[0].operationId)).toEqual([
      id,
      id,
    ]);
    expect(tx.financeMovement.create).toHaveBeenCalledTimes(1);
  });
  it('un rechazo definitivo no crea dinero', async () => {
    const payload = {
      operationId: id,
      saleId,
      kind: 'CONFIRM' as const,
      actorId,
      reason: 'Venta prueba',
      lines: [{ itemId: actorId, quantity: '2' }],
    };
    const operation = {
      id,
      saleId,
      kind: 'CONFIRM',
      status: 'PENDING',
      payload,
    } as unknown as SaleOperation;
    const tx = {
      saleOperation: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      sale: {
        findUnique: vi.fn().mockResolvedValue({ id: saleId, movements: [] }),
        update: vi.fn(),
      },
      financeMovement: { create: vi.fn() },
    };
    const db = {
      $transaction: vi.fn(async (fn) => fn(tx)),
    } as unknown as PrismaService;
    const service = new FinanceService(db, {
      execute: vi.fn().mockResolvedValue({
        operationId: id,
        saleId,
        status: 'REJECTED',
        error: 'Sin stock',
        movements: [],
      }),
    } as unknown as InventoryClient);
    await service.resolve(operation);
    expect(tx.financeMovement.create).not.toHaveBeenCalled();
    expect(tx.sale.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'REJECTED' }),
      }),
    );
  });
});
