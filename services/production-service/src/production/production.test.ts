import { productionIdV1Schema } from '@ambrosia/contracts';
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  formulaInputV1Schema,
  productionInputV1Schema,
  consumptionRequestV1Schema,
  productionYieldInputV1Schema,
  packagingInputV1Schema,
} from '@ambrosia/contracts';
import { calculate, packagedProductQuantity, yieldMetrics } from './domain';
import { InventoryClient } from './inventory.client';
import { ProductionService } from './production.service';
import type { PrismaService } from '../prisma.service';
import type { ProductionOperation } from '../generated/prisma/client';
const id = '11111111-1111-4111-8111-111111111111',
  other = '22222222-2222-4222-8222-222222222222';
const line = { itemId: id, quantity: '0.1', baseUnit: 'GRAM' as const };
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe('contratos y precisión de producción', () => {
  it.each(['0', '-1', '1e3', '1,5', '100000000000000', '0.00000000001'])(
    'rechaza cantidad %s',
    (quantity) => {
      expect(
        productionInputV1Schema.safeParse({
          batch: 'L',
          formulaId: id,
          quantity,
          scheduledAt: new Date().toISOString(),
        }).success,
      ).toBe(false);
    },
  );
  it('rechaza insumos repetidos', () =>
    expect(
      formulaInputV1Schema.safeParse({
        name: 'A',
        productId: other,
        baseUnit: 'GRAM',
        ingredients: [line, line],
        active: true,
      }).success,
    ).toBe(false));
  it('rechaza campos adicionales', () =>
    expect(
      formulaInputV1Schema.safeParse({
        name: 'A',
        productId: other,
        baseUnit: 'GRAM',
        ingredients: [line],
        active: true,
        stock: '2',
      }).success,
    ).toBe(false));
  it('calcula sin float', () =>
    expect(calculate([line], '3')[0]?.quantity).toBe('0.3'));
  it('conserva enteros mayores que MAX_SAFE_INTEGER al multiplicar', () =>
    expect(
      calculate([{ ...line, quantity: '99999999999999.9999999999' }], '1')[0]
        ?.quantity,
    ).toBe('99999999999999.9999999999'));
  it('rechaza resultado fuera de escala sin redondeo silencioso', () =>
    expect(() =>
      calculate([{ ...line, quantity: '0.0000000001' }], '0.1'),
    ).toThrow());
  it('rechaza desbordamiento', () =>
    expect(() =>
      calculate([{ ...line, quantity: '99999999999999' }], '2'),
    ).toThrow());
  it('una compensación requiere operación original', () =>
    expect(
      consumptionRequestV1Schema.safeParse({
        operationId: id,
        productionId: id,
        actorId: id,
        kind: 'REVERSE',
        originalOperationId: null,
        reason: 'Cancelar',
        lines: [line],
      }).success,
    ).toBe(false));
  it('calcula rendimiento, diferencia y merma con Decimal', () => {
    expect(yieldMetrics('2700', '2430', '270')).toEqual({
      plannedQuantity: '2700',
      actualQuantity: '2430',
      differenceQuantity: '-270',
      yieldPercentage: '90',
      wasteQuantity: '270',
      wastePercentage: '10',
    });
  });
  it('redondea solo porcentajes derivados a diez decimales', () => {
    expect(yieldMetrics('3', '1', '2').yieldPercentage).toBe('33.3333333333');
  });
  it('exige motivo cuando existe merma', () =>
    expect(
      productionYieldInputV1Schema.safeParse({
        actualQuantity: '9',
        wasteQuantity: '1',
        occurredAt: new Date().toISOString(),
        expectedVersion: 2,
      }).success,
    ).toBe(false));
  it('calcula producto utilizado sin float y exige unidades enteras', () => {
    expect(packagedProductQuantity('10', '270')).toBe('2700');
    expect(() => packagedProductQuantity('1.5', '270')).toThrow();
  });
  it('rechaza materiales repetidos y campos adicionales al envasar', () => {
    const material = { itemId: id, quantity: '10' };
    expect(
      packagingInputV1Schema.safeParse({
        orderId: other,
        presentationProductId: id,
        unitsPackaged: '10',
        productQuantityPerUnit: '270',
        materials: [material, material],
        occurredAt: new Date().toISOString(),
        expectedVersion: 3,
        price: '1000',
      }).success,
    ).toBe(false);
  });
});
describe('cliente y recuperación', () => {
  it('sin credencial falla cerrado', async () => {
    vi.stubEnv('PRODUCTION_INVENTORY_TOKEN', '');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(
      new InventoryClient().request('items/' + id),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('un timeout no confirma consumo', async () => {
    vi.stubEnv('PRODUCTION_INVENTORY_TOKEN', 'a'.repeat(96));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
    await expect(
      new InventoryClient().request('operations', {}),
    ).rejects.toThrow('no confirmó');
  });
  it('no sigue redirecciones ni envía cookies', async () => {
    vi.stubEnv('PRODUCTION_INVENTORY_TOKEN', 'a'.repeat(96));
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => null });
    vi.stubGlobal('fetch', fetch);
    await new InventoryClient().request('items/' + id);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error' });
    expect(fetch.mock.calls[0]?.[1].headers.Cookie).toBeUndefined();
  });
  it('rechaza producto como ingrediente', async () => {
    await expect(
      new InventoryClient().validateFormula({
        name: 'A',
        productId: id,
        baseUnit: 'GRAM',
        ingredients: [line],
        active: true,
      }),
    ).rejects.toThrow('propio insumo');
  });
  it('resultado perdido conserva el UUID al reintentar', async () => {
    const payload = {
      operationId: id,
      productionId: other,
      actorId: id,
      kind: 'CONSUME' as const,
      originalOperationId: null,
      reason: 'Iniciar',
      lines: [line],
    };
    const operation = {
      id,
      orderId: other,
      kind: 'CONSUME',
      payload,
    } as unknown as ProductionOperation;
    const execute = vi
      .fn()
      .mockRejectedValueOnce(Error('timeout'))
      .mockResolvedValue({
        operationId: id,
        productionId: other,
        status: 'CONFIRMED',
        error: null,
        movements: [],
      });
    const tx = {
      productionOperation: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      productionOrder: { update: vi.fn() },
    };
    const db = {
      $transaction: vi.fn(async (fn) => fn(tx)),
    } as unknown as PrismaService;
    const service = new ProductionService(db, {
      execute,
    } as unknown as InventoryClient);
    await expect(service.resolve(operation)).rejects.toThrow('timeout');
    expect(tx.productionOrder.update).not.toHaveBeenCalled();
    await service.resolve(operation);
    expect(execute.mock.calls.map((c) => c[0].operationId)).toEqual([id, id]);
    expect(tx.productionOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'IN_PROGRESS' }),
      }),
    );
  });
  it('un resultado de otra operación nunca cambia el lote', async () => {
    const execute = vi.fn().mockResolvedValue({
      operationId: other,
      productionId: other,
      status: 'CONFIRMED',
    });
    const db = { $transaction: vi.fn() } as unknown as PrismaService;
    const service = new ProductionService(db, {
      execute,
    } as unknown as InventoryClient);
    await expect(
      service.resolve({
        id,
        orderId: other,
        payload: {
          operationId: id,
          productionId: other,
          actorId: id,
          kind: 'CONSUME',
          originalOperationId: null,
          reason: 'Inicio',
          lines: [line],
        },
      } as unknown as ProductionOperation),
    ).rejects.toThrow();
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

it('normaliza UUID para comparar referencias y claves idempotentes', () => {
  expect(
    productionIdV1Schema.parse('ABCDEFAB-1111-4111-8111-111111111111'),
  ).toBe('abcdefab-1111-4111-8111-111111111111');
});
