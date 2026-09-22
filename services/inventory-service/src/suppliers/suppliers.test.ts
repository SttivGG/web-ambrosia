import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createSupplierV1Schema,
  updateSupplierV1Schema,
  supplierFiltersV1Schema,
  normalizeSupplierIdentification,
} from '@ambrosia/contracts';
import {
  validateIdentification,
  supplierDatabaseError,
  SupplierError,
} from './domain';
import { SuppliersService } from './suppliers.service';
import { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../prisma.service';
const valid = { code: 'PROV-001', name: 'Proveedor local' };
describe('Contratos proveedores', () => {
  it('normaliza código y conserva identificación visible', () => {
    const result = createSupplierV1Schema.parse({
      ...valid,
      code: ' prov-001 ',
      identificationType: 'NIT',
      identificationNumber: ' 001.234-5 ',
    });
    expect(result.code).toBe('PROV-001');
    expect(result.identificationNumber).toBe('001.234-5');
    expect(normalizeSupplierIdentification(result.identificationNumber!)).toBe(
      '0012345',
    );
    expect(normalizeSupplierIdentification('0012345')).not.toBe(
      normalizeSupplierIdentification('12345'),
    );
    expect(normalizeSupplierIdentification('123-4')).not.toBe(
      normalizeSupplierIdentification('123-5'),
    );
  });
  it('permite proveedor sin identificación fiscal', () =>
    expect(createSupplierV1Schema.parse(valid)).toEqual(valid));
  it.each([
    { identificationType: 'NIT' },
    { identificationNumber: '123' },
    { identificationType: 'NIT', identificationNumber: '---' },
    { identificationType: null, identificationNumber: '123' },
  ])('rechaza pareja inválida %j', (fields) =>
    expect(
      createSupplierV1Schema.safeParse({ ...valid, ...fields }).success,
    ).toBe(false),
  );
  it.each(['', 'A', '-ABC', 'A B', 'ÑABC', 'A'.repeat(41)])(
    'rechaza código inválido %s',
    (code) =>
      expect(createSupplierV1Schema.safeParse({ ...valid, code }).success).toBe(
        false,
      ),
  );
  it.each([
    ['name', 161],
    ['tradeName', 161],
    ['identificationNumber', 41],
    ['contactName', 121],
    ['email', 255],
    ['phone', 41],
    ['address', 241],
    ['municipality', 101],
    ['department', 101],
    ['notes', 2001],
  ] as const)('limita %s', (field, size) =>
    expect(
      createSupplierV1Schema.safeParse({ ...valid, [field]: 'a'.repeat(size) })
        .success,
    ).toBe(false),
  );
  it.each([
    'tradeName',
    'contactName',
    'email',
    'phone',
    'address',
    'municipality',
    'department',
    'notes',
  ])('vacío equivale a null en %s', (field) =>
    expect(
      createSupplierV1Schema.parse({ ...valid, [field]: '   ' }),
    ).toHaveProperty(field, null),
  );
  it.each(['active', 'version', 'price', 'balance', 'unknown'])(
    'rechaza campo desconocido %s',
    (field) =>
      expect(
        createSupplierV1Schema.safeParse({ ...valid, [field]: 1 }).success,
      ).toBe(false),
  );
  it('PATCH conserva campos y asociaciones omitidos', () =>
    expect(
      updateSupplierV1Schema.parse({ expectedVersion: 1, name: 'Nuevo' }),
    ).toEqual({ expectedVersion: 1, name: 'Nuevo' }));
  it('PATCH rechaza código e identificación inválida al fusionar', () => {
    expect(
      updateSupplierV1Schema.safeParse({ expectedVersion: 1, code: 'CAMBIO' })
        .success,
    ).toBe(false);
    expect(() =>
      validateIdentification({
        identificationType: 'NIT',
        identificationNumber: null,
      }),
    ).toThrow(SupplierError);
  });
  it('rechaza artículos repetidos y límite excesivo', () => {
    const id = randomUUID();
    expect(
      createSupplierV1Schema.safeParse({ ...valid, itemIds: [id, id] }).success,
    ).toBe(false);
    expect(
      createSupplierV1Schema.safeParse({
        ...valid,
        itemIds: Array.from({ length: 501 }, () => randomUUID()),
      }).success,
    ).toBe(false);
  });
  it.each([
    { page: '0' },
    { pageSize: '101' },
    { active: 'yes' },
    { sortBy: 'notes' },
    { itemId: 'bad' },
    { unexpected: 'x' },
  ])('rechaza filtros inválidos %j', (query) =>
    expect(supplierFiltersV1Schema.safeParse(query).success).toBe(false),
  );
  it('filtros predeterminados estables', () =>
    expect(supplierFiltersV1Schema.parse({})).toEqual({
      page: 1,
      pageSize: 20,
      sortBy: 'name',
      sortOrder: 'asc',
    }));
});
describe('Transacciones de proveedores (dobles unitarios)', () => {
  const record = () => ({
    id: randomUUID(),
    ...valid,
    tradeName: null,
    identificationType: null,
    identificationNumber: null,
    normalizedIdentification: null,
    contactName: null,
    email: null,
    phone: null,
    address: null,
    municipality: null,
    department: null,
    notes: null,
    active: true,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    archivedAt: null,
    items: [],
  });
  function setup(row = record()) {
    const tx = {
      supplier: {
        findUnique: vi.fn().mockResolvedValue(row),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockResolvedValue(row),
      },
      supplierItem: { deleteMany: vi.fn(), createMany: vi.fn() },
      $queryRaw: vi.fn(),
    };
    const db = {
      $transaction: vi.fn(async (work: (tx: unknown) => unknown) => work(tx)),
    };
    return {
      row,
      tx,
      db,
      service: new SuppliersService(db as unknown as PrismaService),
    };
  }
  it('PATCH omitido no toca asociaciones; actualización usa id y versión', async () => {
    const { row, tx, db, service } = setup();
    await service.update(row.id, { expectedVersion: 1, notes: 'Cambio' });
    expect(tx.supplierItem.deleteMany).not.toHaveBeenCalled();
    expect(tx.supplierItem.createMany).not.toHaveBeenCalled();
    expect(tx.supplier.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: row.id, version: 1 },
        data: expect.objectContaining({
          notes: 'Cambio',
          version: { increment: 1 },
        }),
      }),
    );
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });
  it('versión obsoleta no escribe', async () => {
    const { row, tx, service } = setup();
    await expect(
      service.update(row.id, { expectedVersion: 2 }),
    ).rejects.toThrow(SupplierError);
    expect(tx.supplier.updateMany).not.toHaveBeenCalled();
  });
  it('artículo inexistente impide toda escritura', async () => {
    const { row, tx, service } = setup();
    tx.$queryRaw.mockResolvedValue([]);
    await expect(
      service.update(row.id, { expectedVersion: 1, itemIds: [randomUUID()] }),
    ).rejects.toThrow('no existe');
    expect(tx.supplier.updateMany).not.toHaveBeenCalled();
  });
  it('artículo archivado impide nueva asociación', async () => {
    const { row, tx, service } = setup();
    const id = randomUUID();
    tx.$queryRaw.mockResolvedValue([{ id, active: false }]);
    await expect(
      service.update(row.id, { expectedVersion: 1, itemIds: [id] }),
    ).rejects.toThrow('activos');
    expect(tx.supplier.updateMany).not.toHaveBeenCalled();
  });
  it('desasociar usa el proveedor como límite', async () => {
    const { row, tx, service } = setup();
    await service.update(row.id, { expectedVersion: 1, itemIds: [] });
    expect(tx.supplierItem.deleteMany).toHaveBeenCalledWith({
      where: { supplierId: row.id, itemId: { notIn: [] } },
    });
  });
  it('archivar no modifica artículos', async () => {
    const { row, tx, service } = setup();
    await service.state(row.id, 1, false);
    expect(tx.supplier.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          active: false,
          archivedAt: expect.any(Date),
        }),
      }),
    );
    expect(tx.supplierItem.deleteMany).not.toHaveBeenCalled();
  });
  it('transición idempotente exige versión vigente', async () => {
    const { row, tx, service } = setup();
    await service.state(row.id, 1, true);
    expect(tx.supplier.updateMany).not.toHaveBeenCalled();
    await expect(service.state(row.id, 2, true)).rejects.toThrow(SupplierError);
  });
  it('fallo posterior de asociaciones rechaza la transacción sin reintentos', async () => {
    const { row, tx, db, service } = setup();
    tx.supplierItem.deleteMany.mockRejectedValue(new Error('private SQL'));
    await expect(
      service.update(row.id, { expectedVersion: 1, itemIds: [] }),
    ).rejects.toThrow('Consulta el estado');
    expect(db.$transaction).toHaveBeenCalledOnce();
  });
});
it.each(['P2034', 'P2025'])('traduce %s como conflicto', (code) => {
  try {
    supplierDatabaseError(
      new Prisma.PrismaClientKnownRequestError('private SQL', {
        code,
        clientVersion: '7',
      }),
    );
  } catch (error) {
    expect((error as SupplierError).getResponse()).toMatchObject({
      code: 'CONCURRENT_MODIFICATION',
    });
  }
});
it.each([
  ['Supplier_code_key', 'SUPPLIER_CODE_ALREADY_EXISTS'],
  [
    'Supplier_identificationType_normalizedIdentification_key',
    'SUPPLIER_IDENTIFICATION_ALREADY_EXISTS',
  ],
])('traduce unicidad %s', (target, code) => {
  try {
    supplierDatabaseError(
      new Prisma.PrismaClientKnownRequestError('private SQL', {
        code: 'P2002',
        clientVersion: '7',
        meta: { target },
      }),
    );
  } catch (error) {
    expect((error as SupplierError).getResponse()).toMatchObject({ code });
  }
});

it.each(['40001', '40P01'])(
  'traduce SQLSTATE %s al bloquear artículos',
  (sqlstate) => {
    expect.assertions(1);
    try {
      supplierDatabaseError(
        new Prisma.PrismaClientKnownRequestError('private SQL', {
          code: 'P2010',
          clientVersion: '7',
          meta: { code: sqlstate },
        }),
      );
    } catch (error) {
      expect((error as SupplierError).getResponse()).toMatchObject({
        code: 'CONCURRENT_MODIFICATION',
      });
    }
  },
);
