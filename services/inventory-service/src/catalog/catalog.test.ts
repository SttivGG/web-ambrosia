import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createCategoryV1Schema,
  createItemV1Schema,
  updateItemV1Schema,
  itemFiltersV1Schema,
  categoryFiltersV1Schema,
  decimalV1Schema,
  versionV1Schema,
} from '@ambrosia/contracts';
import {
  CatalogError,
  categorySlug,
  normalizeName,
  validateItem,
  requireVersion,
  translatePrisma,
} from './domain';
import { Prisma } from '../generated/prisma/client';
import { CatalogService, auditRecord } from './catalog.service';
import type { PrismaService } from '../prisma.service';
const valid = {
  sku: 'LECHE-ENTERA',
  name: 'Leche entera',
  itemType: 'RAW_MATERIAL' as const,
  categoryId: randomUUID(),
  inventoryBaseUnit: 'MILLILITER' as const,
  defaultOperationUnit: 'LITER' as const,
  trackInventory: true,
};
describe('Contratos de catálogo v1', () => {
  it('PATCH conserva seguimiento cuando se omite el campo', () => {
    expect(
      updateItemV1Schema.parse({ expectedVersion: 1, name: 'Prueba' }),
    ).not.toHaveProperty('trackInventory');
  });
  it('limpia nombres y normaliza SKU', () => {
    expect(createCategoryV1Schema.parse({ name: '  Lácteos  ' }).name).toBe(
      'Lácteos',
    );
    expect(
      createItemV1Schema.parse({ ...valid, sku: 'leche-entera' }).sku,
    ).toBe('LECHE-ENTERA');
  });
  it.each([
    'A',
    'AB',
    'CON ESPACIOS',
    '-INICIO',
    'CON.PUNTO',
    'A'.repeat(41),
    ' LECHE',
    'LECHE ',
  ])('rechaza SKU inválido %s', (sku) => {
    expect(createItemV1Schema.safeParse({ ...valid, sku }).success).toBe(false);
  });
  it.each(['', 'A', 'A'.repeat(81)])(
    'rechaza nombre de categoría %s',
    (name) => {
      expect(createCategoryV1Schema.safeParse({ name }).success).toBe(false);
    },
  );
  it('rechaza SKU, active y stock en actualización', () => {
    for (const key of ['sku', 'active', 'currentStock', 'purchasePrice'])
      expect(
        updateItemV1Schema.safeParse({ expectedVersion: 1, [key]: 'X' })
          .success,
      ).toBe(false);
  });
  it.each(['0', '0.0000000001', '4.0000000000', '99999999999999.9999999999'])(
    'acepta decimal exacto %s',
    (value) => expect(decimalV1Schema.safeParse(value).success).toBe(true),
  );
  it.each([
    4,
    '1e2',
    '-1',
    'NaN',
    '01',
    '.4',
    '4.',
    '0.00000000001',
    '100000000000000',
    '1,2',
  ])('rechaza decimal %s', (value) =>
    expect(decimalV1Schema.safeParse(value).success).toBe(false),
  );
  it('exige versión entera positiva', () => {
    for (const expectedVersion of [undefined, '1', 0, -1, 1.1, 2147483647])
      expect(versionV1Schema.safeParse({ expectedVersion }).success).toBe(
        false,
      );
  });
  it('filtros combinables y defaults', () => {
    expect(
      itemFiltersV1Schema.parse({
        active: 'false',
        itemType: 'PACKAGING',
        inventoryBaseUnit: 'UNIT',
      }),
    ).toMatchObject({
      page: 1,
      pageSize: 20,
      active: false,
      sortBy: 'name',
      sortOrder: 'asc',
    });
  });
  it.each([
    { page: '0' },
    { pageSize: '101' },
    { page: '1.5' },
    { active: 'yes' },
    { sortBy: 'normalizedName' },
    { sortOrder: 'DROP TABLE' },
    { other: 'x' },
    { page: '' },
  ])('rechaza filtros %j', (value) =>
    expect(itemFiltersV1Schema.safeParse(value).success).toBe(false),
  );
  it('categorías tienen lista blanca separada', () =>
    expect(categoryFiltersV1Schema.safeParse({ sortBy: 'sku' }).success).toBe(
      false,
    ));
});
describe('Reglas de dominio', () => {
  it('nombre normalizado Unicode e insensible a mayúsculas', () =>
    expect(normalizeName('  LÁCTEOS  ')).toBe(normalizeName('Lácteos')));
  it('slug estable, seguro y único incluso con nombres transliterados iguales', () => {
    const id = randomUUID();
    expect(categorySlug('Leche y cultívos', id)).toBe('leche-y-cultivos-' + id);
    expect(categorySlug('乳', id)).toBe('categoria-' + id);
  });
  it.each([
    ['UNIT', 'UNIT'],
    ['GRAM', 'GRAM'],
    ['GRAM', 'KILOGRAM'],
    ['MILLILITER', 'MILLILITER'],
    ['MILLILITER', 'LITER'],
  ] as const)('permite %s / %s', (inventoryBaseUnit, defaultOperationUnit) =>
    expect(() =>
      validateItem({ ...valid, inventoryBaseUnit, defaultOperationUnit }),
    ).not.toThrow(),
  );
  it.each([
    ['GRAM', 'LITER'],
    ['MILLILITER', 'KILOGRAM'],
    ['UNIT', 'GRAM'],
  ] as const)('rechaza %s / %s', (inventoryBaseUnit, defaultOperationUnit) =>
    expect(() =>
      validateItem({ ...valid, inventoryBaseUnit, defaultOperationUnit }),
    ).toThrow(CatalogError),
  );
  it('packaging requiere unidades y byproduct masa o volumen', () => {
    expect(() => validateItem({ ...valid, itemType: 'PACKAGING' })).toThrow();
    expect(() =>
      validateItem({
        ...valid,
        itemType: 'BYPRODUCT',
        inventoryBaseUnit: 'UNIT',
        defaultOperationUnit: 'UNIT',
      }),
    ).toThrow();
  });
  it.each(['4', '8'])(
    'recipiente de %s oz sin inferir peso',
    (nominalCapacityValue) =>
      expect(() =>
        validateItem({
          ...valid,
          itemType: 'PACKAGING',
          inventoryBaseUnit: 'UNIT',
          defaultOperationUnit: 'UNIT',
          nominalCapacityValue,
          nominalCapacityUnit: 'FLUID_OUNCE',
        }),
      ).not.toThrow(),
  );
  it.each([
    { nominalCapacityValue: '4' },
    { nominalCapacityUnit: 'GRAM' as const },
    {
      nominalCapacityValue: '0.000',
      nominalCapacityUnit: 'FLUID_OUNCE' as const,
    },
  ])('capacidad incompleta/cero %j', (value) =>
    expect(() => validateItem({ ...valid, ...value })).toThrow(),
  );
  it('versión obsoleta produce conflicto', () => {
    expect(() => requireVersion(2, 1)).toThrow(CatalogError);
    expect(() => requireVersion(2, 2)).not.toThrow();
  });
  it.each([
    ['P2002', 'normalizedSku', 'ITEM_SKU_ALREADY_EXISTS'],
    ['P2002', 'barcode', 'ITEM_BARCODE_ALREADY_EXISTS'],
    ['P2002', 'normalizedName', 'CATEGORY_NAME_ALREADY_EXISTS'],
    ['P2034', '', 'CONCURRENT_MODIFICATION'],
    ['P2025', '', 'CONCURRENT_MODIFICATION'],
    ['P2003', '', 'CATEGORY_NOT_FOUND'],
  ])('traduce %s %s', (code, target, expected) => {
    try {
      translatePrisma(
        new Prisma.PrismaClientKnownRequestError('secret SQL', {
          code,
          clientVersion: '7',
          meta: { target: [target] },
        }),
      );
    } catch (e) {
      expect(e).toBeInstanceOf(CatalogError);
      expect((e as CatalogError).code).toBe(expected);
      expect(JSON.stringify(e)).not.toContain('secret SQL');
    }
  });
  it('auditoría solo admite campos explícitos', () => {
    const record = auditRecord(
      { subject: 'subject', correlationId: 'correlation', token: 'secret' } as {
        subject: string;
        correlationId: string;
      },
      'item.updated',
      'id',
      'success',
    );
    expect(Object.keys(record)).toEqual([
      'event',
      'subject',
      'correlationId',
      'action',
      'resourceId',
      'result',
    ]);
    expect(JSON.stringify(record)).not.toContain('secret');
  });
});
describe('Concurrencia y archivado del servicio', () => {
  const context = { subject: randomUUID(), correlationId: 'test' };
  function setup(active = true, version = 1) {
    const row = {
      id: randomUUID(),
      name: 'Leche',
      normalizedName: 'leche',
      slug: 'leche-test',
      description: null,
      active,
      version,
      createdAt: new Date(),
      updatedAt: new Date(),
      archivedAt: active ? null : new Date(),
    };
    const tx = {
      category: {
        findUnique: vi.fn().mockResolvedValue(row),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      catalogItem: { count: vi.fn().mockResolvedValue(0) },
    };
    const db = {
      $transaction: vi.fn((work: (arg: typeof tx) => unknown) => work(tx)),
    };
    return {
      row,
      tx,
      db,
      service: new CatalogService(db as unknown as PrismaService),
    };
  }
  it('impide archivar categorías con artículos activos', async () => {
    const { service, row, tx } = setup();
    tx.catalogItem.count.mockResolvedValue(1);
    await expect(
      service.categoryState(row.id, 1, false, context),
    ).rejects.toMatchObject({ code: 'CATEGORY_HAS_ACTIVE_ITEMS' });
    expect(tx.category.updateMany).not.toHaveBeenCalled();
  });
  it('restaurar categoría activa es idempotente con versión vigente', async () => {
    const { service, row, tx } = setup();
    const result = await service.categoryState(row.id, 1, true, context);
    expect(result.version).toBe(1);
    expect(result).not.toHaveProperty('normalizedName');
    expect(tx.category.updateMany).not.toHaveBeenCalled();
  });
  it('restauración idempotente no elude versión', async () => {
    const { service, row } = setup(true, 2);
    await expect(
      service.categoryState(row.id, 1, true, context),
    ).rejects.toMatchObject({ code: 'CONCURRENT_MODIFICATION' });
  });
  it('actualiza con id + versión y aislamiento serializable', async () => {
    const { service, row, tx, db } = setup();
    await service.updateCategory(
      row.id,
      { expectedVersion: 1, name: 'Nueva' },
      context,
    );
    expect(tx.category.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: row.id, version: 1 },
        data: expect.objectContaining({ version: { increment: 1 } }),
      }),
    );
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });
  it('cero filas actualizadas es conflicto', async () => {
    const { service, row, tx } = setup();
    tx.category.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.updateCategory(row.id, { expectedVersion: 1 }, context),
    ).rejects.toMatchObject({ code: 'CONCURRENT_MODIFICATION' });
  });
});

it.each([
  ['CatalogItem_sku_key', 'ITEM_SKU_ALREADY_EXISTS'],
  ['CatalogItem_normalizedSku_key', 'ITEM_SKU_ALREADY_EXISTS'],
  ['CatalogItem_barcode_key', 'ITEM_BARCODE_ALREADY_EXISTS'],
  ['Category_normalizedName_key', 'CATEGORY_NAME_ALREADY_EXISTS'],
  ['Category_slug_key', 'CATEGORY_NAME_ALREADY_EXISTS'],
])('traduce índices del adaptador pg: %s', (index, code) => {
  const error = new Prisma.PrismaClientKnownRequestError('private SQL', {
    code: 'P2002',
    clientVersion: '7',
    meta: { driverAdapterError: { cause: { constraint: { index } } } },
  });
  try {
    translatePrisma(error);
  } catch (e) {
    expect(e).toBeInstanceOf(CatalogError);
    expect((e as CatalogError).code).toBe(code);
    expect(JSON.stringify(e)).not.toContain('private SQL');
  }
});
