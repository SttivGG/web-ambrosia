import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  supplierV1Schema,
  normalizeSupplierIdentification,
  type CreateSupplierV1,
  type UpdateSupplierV1,
  type SupplierFiltersV1,
} from '@ambrosia/contracts';
import { PrismaService } from '../prisma.service';
import { Prisma } from '../generated/prisma/client';
import {
  SupplierError,
  supplierConflict,
  supplierDatabaseError,
  validateIdentification,
} from './domain';
const include = {
  items: { include: { item: true }, orderBy: { itemId: 'asc' as const } },
};
type Row = Prisma.SupplierGetPayload<{ include: typeof include }>;
const dto = (row: Row) => {
  const { items } = row;
  const fields = Object.fromEntries(
    Object.entries(row).filter(
      ([key]) => !['normalizedIdentification', 'items'].includes(key),
    ),
  );
  return supplierV1Schema.parse({
    ...fields,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
    items: items.map(({ item }) => ({
      id: item.id,
      sku: item.sku,
      name: item.name,
      active: item.active,
    })),
  });
};
@Injectable()
export class SuppliersService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}
  private async transaction<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    try {
      return await this.db.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      supplierDatabaseError(error);
    }
  }
  private async row(tx: Prisma.TransactionClient, id: string) {
    const row = await tx.supplier.findUnique({ where: { id }, include });
    if (!row)
      throw new SupplierError(
        'SUPPLIER_NOT_FOUND',
        404,
        'El proveedor no existe.',
      );
    return row;
  }
  async get(id: string) {
    try {
      return dto(await this.row(this.db, id));
    } catch (error) {
      supplierDatabaseError(error);
    }
  }
  async list(q: SupplierFiltersV1) {
    const where: Prisma.SupplierWhereInput = {
      active: q.active,
      ...(q.itemId ? { items: { some: { itemId: q.itemId } } } : {}),
      ...(q.search
        ? {
            OR: [
              { code: { contains: q.search, mode: 'insensitive' } },
              { name: { contains: q.search, mode: 'insensitive' } },
              { tradeName: { contains: q.search, mode: 'insensitive' } },
              ...(normalizeSupplierIdentification(q.search)
                ? [
                    {
                      normalizedIdentification: {
                        contains: normalizeSupplierIdentification(q.search),
                      },
                    },
                  ]
                : []),
            ],
          }
        : {}),
    };
    try {
      const [rows, totalItems] = await this.db.$transaction(
        [
          this.db.supplier.findMany({
            where,
            include,
            skip: (q.page - 1) * q.pageSize,
            take: q.pageSize,
            orderBy: [{ [q.sortBy]: q.sortOrder }, { id: 'asc' }],
          }),
          this.db.supplier.count({ where }),
        ],
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
      return {
        data: rows.map(dto),
        pagination: {
          page: q.page,
          pageSize: q.pageSize,
          totalItems,
          totalPages: Math.ceil(totalItems / q.pageSize),
        },
      };
    } catch (error) {
      supplierDatabaseError(error);
    }
  }
  private async associations(
    tx: Prisma.TransactionClient,
    ids: string[],
    existing: string[],
  ) {
    if (ids.length > 500 || new Set(ids).size !== ids.length)
      throw new SupplierError(
        'VALIDATION_ERROR',
        400,
        'No repitas artículos; máximo 500.',
        ['itemIds'],
      );
    const added = ids.filter((id) => !existing.includes(id)).sort();
    if (!added.length) return;
    // Coordinates with Catalog UPDATE; a later archive may preserve an existing link.
    const rows = await tx.$queryRaw<{ id: string; active: boolean }[]>(
      Prisma.sql`SELECT "id", "active" FROM "CatalogItem" WHERE "id" IN (${Prisma.join(added.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY "id" FOR SHARE`,
    );
    if (rows.length !== added.length)
      throw new SupplierError(
        'ITEM_NOT_FOUND',
        400,
        'Uno de los artículos no existe.',
        ['itemIds'],
      );
    if (rows.some((row) => !row.active))
      throw new SupplierError(
        'ITEM_ARCHIVED',
        409,
        'Solo puedes agregar artículos activos.',
        ['itemIds'],
      );
  }
  create(data: CreateSupplierV1) {
    return this.transaction(async (tx) => {
      validateIdentification(data);
      const { itemIds = [], ...fields } = data;
      await this.associations(tx, itemIds, []);
      return dto(
        await tx.supplier.create({
          data: {
            ...fields,
            id: randomUUID(),
            normalizedIdentification: data.identificationNumber
              ? normalizeSupplierIdentification(data.identificationNumber)
              : null,
            items: { create: itemIds.map((itemId) => ({ itemId })) },
          },
          include,
        }),
      );
    });
  }
  update(id: string, data: UpdateSupplierV1) {
    return this.transaction(async (tx) => {
      const row = await this.row(tx, id);
      if (row.version !== data.expectedVersion) throw supplierConflict();
      const { expectedVersion, itemIds, ...fields } = data;
      const merged = { ...row, ...fields };
      validateIdentification(merged);
      if (itemIds !== undefined)
        await this.associations(
          tx,
          itemIds,
          row.items.map((item) => item.itemId),
        );
      const result = await tx.supplier.updateMany({
        where: { id, version: expectedVersion },
        data: {
          ...fields,
          normalizedIdentification: merged.identificationNumber
            ? normalizeSupplierIdentification(merged.identificationNumber)
            : null,
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) throw supplierConflict();
      if (itemIds !== undefined) {
        await tx.supplierItem.deleteMany({
          where: { supplierId: id, itemId: { notIn: itemIds } },
        });
        const existing = new Set(row.items.map((item) => item.itemId));
        const added = itemIds.filter((itemId) => !existing.has(itemId));
        if (added.length)
          await tx.supplierItem.createMany({
            data: added.map((itemId) => ({ supplierId: id, itemId })),
          });
      }
      return dto(await this.row(tx, id));
    });
  }
  state(id: string, expectedVersion: number, active: boolean) {
    return this.transaction(async (tx) => {
      const row = await this.row(tx, id);
      if (row.version !== expectedVersion) throw supplierConflict();
      if (row.active === active) return dto(row);
      const result = await tx.supplier.updateMany({
        where: { id, version: expectedVersion },
        data: {
          active,
          archivedAt: active ? null : new Date(),
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) throw supplierConflict();
      return dto(await this.row(tx, id));
    });
  }
}
