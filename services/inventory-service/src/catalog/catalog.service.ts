import { Injectable, Inject, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  categoryV1Schema,
  catalogItemV1Schema,
  type CategoryFiltersV1,
  type ItemFiltersV1,
  type CreateCategoryV1,
  type UpdateCategoryV1,
  type CreateItemV1,
  type UpdateItemV1,
} from '@ambrosia/contracts';
import { PrismaService } from '../prisma.service';
import {
  Prisma,
  type Category,
  type CatalogItem,
} from '../generated/prisma/client';
import {
  CatalogError,
  normalizeName,
  categorySlug,
  requireVersion,
  validateItem,
  translatePrisma,
  conflict,
} from './domain';
export type AuditContext = { subject: string; correlationId: string };
export function auditRecord(
  context: AuditContext,
  action: string,
  resourceId: string,
  result: string,
) {
  return {
    event: 'catalog.mutation',
    subject: context.subject,
    correlationId: context.correlationId,
    action,
    resourceId,
    result,
  };
}
const categoryDTO = (row: Category) =>
  categoryV1Schema.parse({
    ...Object.fromEntries(
      Object.entries(row).filter(([key]) => key !== 'normalizedName'),
    ),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
  });
const itemDTO = (row: CatalogItem) =>
  catalogItemV1Schema.parse({
    ...Object.fromEntries(
      Object.entries(row).filter(
        ([key]) => !['normalizedName', 'normalizedSku'].includes(key),
      ),
    ),
    nominalCapacityValue: row.nominalCapacityValue?.toFixed() ?? null,
    minimumStockBase: row.minimumStockBase?.toFixed() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
  });
const pageResult = <T>(
  data: T[],
  totalItems: number,
  q: { page: number; pageSize: number },
) => ({
  data,
  pagination: {
    page: q.page,
    pageSize: q.pageSize,
    totalItems,
    totalPages: Math.ceil(totalItems / q.pageSize),
  },
});
@Injectable()
export class CatalogService {
  private readonly logger = new Logger('Catalog');
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}
  private async mutate<T>(
    action: string,
    id: string,
    context: AuditContext,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    try {
      const result = await this.db.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
      this.logger.log(auditRecord(context, action, id, 'success'));
      return result;
    } catch (error) {
      this.logger.warn(auditRecord(context, action, id, 'rejected'));
      translatePrisma(error);
    }
  }
  private async category(tx: Prisma.TransactionClient, id: string) {
    const row = await tx.category.findUnique({ where: { id } });
    if (!row)
      throw new CatalogError(
        'CATEGORY_NOT_FOUND',
        404,
        'La categoría no existe.',
      );
    return row;
  }
  private async item(tx: Prisma.TransactionClient, id: string) {
    const row = await tx.catalogItem.findUnique({ where: { id } });
    if (!row)
      throw new CatalogError('ITEM_NOT_FOUND', 404, 'El artículo no existe.');
    return row;
  }
  private async activeCategory(tx: Prisma.TransactionClient, id: string) {
    const category = await this.category(tx, id);
    if (!category.active)
      throw new CatalogError(
        'CATEGORY_ARCHIVED',
        409,
        'Restaura la categoría antes de activar artículos en ella.',
        ['categoryId'],
      );
  }
  async getCategory(id: string) {
    return categoryDTO(await this.category(this.db, id));
  }
  async getItem(id: string) {
    return itemDTO(await this.item(this.db, id));
  }
  async listCategories(q: CategoryFiltersV1) {
    const where: Prisma.CategoryWhereInput = {
      active: q.active,
      ...(q.search
        ? { normalizedName: { contains: normalizeName(q.search) } }
        : {}),
    };
    const [rows, count] = await this.db.$transaction(
      [
        this.db.category.findMany({
          where,
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
          orderBy: [{ [q.sortBy]: q.sortOrder }, { id: 'asc' }],
        }),
        this.db.category.count({ where }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return pageResult(rows.map(categoryDTO), count, q);
  }
  async listItems(q: ItemFiltersV1) {
    const where: Prisma.CatalogItemWhereInput = {
      active: q.active,
      categoryId: q.categoryId,
      itemType: q.itemType,
      inventoryBaseUnit: q.inventoryBaseUnit,
      ...(q.search
        ? {
            OR: [
              { normalizedName: { contains: normalizeName(q.search) } },
              { normalizedSku: { contains: q.search.toUpperCase() } },
              { barcode: { contains: q.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [rows, count] = await this.db.$transaction(
      [
        this.db.catalogItem.findMany({
          where,
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
          orderBy: [{ [q.sortBy]: q.sortOrder }, { id: 'asc' }],
        }),
        this.db.catalogItem.count({ where }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return pageResult(rows.map(itemDTO), count, q);
  }
  createCategory(data: CreateCategoryV1, context: AuditContext) {
    const id = randomUUID();
    return this.mutate('category.created', id, context, async (tx) =>
      categoryDTO(
        await tx.category.create({
          data: {
            ...data,
            id,
            normalizedName: normalizeName(data.name),
            slug: categorySlug(data.name, id),
          },
        }),
      ),
    );
  }
  updateCategory(id: string, data: UpdateCategoryV1, context: AuditContext) {
    return this.mutate('category.updated', id, context, async (tx) => {
      const row = await this.category(tx, id);
      requireVersion(row.version, data.expectedVersion);
      const { expectedVersion, ...changes } = data;
      const result = await tx.category.updateMany({
        where: { id, version: expectedVersion },
        data: {
          ...changes,
          ...(changes.name
            ? { normalizedName: normalizeName(changes.name) }
            : {}),
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) throw conflict();
      return categoryDTO(await this.category(tx, id));
    });
  }
  categoryState(
    id: string,
    expectedVersion: number,
    active: boolean,
    context: AuditContext,
  ) {
    return this.mutate(
      active ? 'category.restored' : 'category.archived',
      id,
      context,
      async (tx) => {
        const row = await this.category(tx, id);
        requireVersion(row.version, expectedVersion);
        if (row.active === active) return categoryDTO(row);
        if (
          !active &&
          (await tx.catalogItem.count({
            where: { categoryId: id, active: true },
          }))
        )
          throw new CatalogError(
            'CATEGORY_HAS_ACTIVE_ITEMS',
            409,
            'Archiva los artículos activos antes de archivar esta categoría.',
          );
        const result = await tx.category.updateMany({
          where: { id, version: expectedVersion },
          data: {
            active,
            archivedAt: active ? null : new Date(),
            version: { increment: 1 },
          },
        });
        if (result.count !== 1) throw conflict();
        return categoryDTO(await this.category(tx, id));
      },
    );
  }
  createItem(data: CreateItemV1, context: AuditContext) {
    validateItem(data);
    const id = randomUUID();
    return this.mutate('item.created', id, context, async (tx) => {
      await this.activeCategory(tx, data.categoryId);
      return itemDTO(
        await tx.catalogItem.create({
          data: {
            ...data,
            id,
            normalizedName: normalizeName(data.name),
            normalizedSku: data.sku,
          },
        }),
      );
    });
  }
  updateItem(id: string, data: UpdateItemV1, context: AuditContext) {
    return this.mutate('item.updated', id, context, async (tx) => {
      const row = await this.item(tx, id);
      requireVersion(row.version, data.expectedVersion);
      const { expectedVersion, ...changes } = data;
      const merged = { ...itemDTO(row), ...changes };
      if (
        (merged.inventoryBaseUnit !== row.inventoryBaseUnit ||
          merged.trackInventory !== row.trackInventory) &&
        (await tx.inventoryMovement.count({ where: { itemId: id } }))
      ) {
        throw new CatalogError(
          'INVENTORY_HISTORY_EXISTS',
          409,
          'La unidad y el seguimiento no pueden cambiar cuando existe historial.',
          ['inventoryBaseUnit', 'trackInventory'],
        );
      }
      validateItem(merged);
      if (row.active) await this.activeCategory(tx, merged.categoryId);
      else await this.category(tx, merged.categoryId);
      const result = await tx.catalogItem.updateMany({
        where: { id, version: expectedVersion },
        data: {
          ...changes,
          ...(changes.name
            ? { normalizedName: normalizeName(changes.name) }
            : {}),
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) throw conflict();
      return itemDTO(await this.item(tx, id));
    });
  }
  itemState(
    id: string,
    expectedVersion: number,
    active: boolean,
    context: AuditContext,
  ) {
    return this.mutate(
      active ? 'item.restored' : 'item.archived',
      id,
      context,
      async (tx) => {
        const row = await this.item(tx, id);
        requireVersion(row.version, expectedVersion);
        if (row.active === active)
          throw new CatalogError(
            active ? 'ITEM_ALREADY_ACTIVE' : 'ITEM_ALREADY_ARCHIVED',
            409,
            active
              ? 'El artículo ya está activo.'
              : 'El artículo ya está archivado.',
          );
        if (active) await this.activeCategory(tx, row.categoryId);
        const result = await tx.catalogItem.updateMany({
          where: { id, version: expectedVersion },
          data: {
            active,
            archivedAt: active ? null : new Date(),
            version: { increment: 1 },
          },
        });
        if (result.count !== 1) throw conflict();
        return itemDTO(await this.item(tx, id));
      },
    );
  }
}
