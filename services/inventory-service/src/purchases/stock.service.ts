import { Inject, Injectable } from '@nestjs/common';
import {
  adjustmentV1Schema,
  movementV1Schema,
  stockV1Schema,
  type AdjustmentV1,
  type MovementFiltersV1,
  type StockFiltersV1,
} from '@ambrosia/contracts';
import { PrismaService } from '../prisma.service';
import {
  Prisma,
  type CatalogItem,
  type InventoryBaseUnit,
  type MovementType,
} from '../generated/prisma/client';
import { PurchaseError, databaseError, pagination, parse } from './domain';
const movementInclude = { item: true, purchaseLine: true };
type MovementRow = Prisma.InventoryMovementGetPayload<{
  include: typeof movementInclude;
}>;
export const movementDTO = (r: MovementRow) =>
  movementV1Schema.parse({
    ...r,
    quantity: r.quantity.toFixed(),
    occurredAt: r.occurredAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
    purchaseId: r.purchaseLine?.purchaseId ?? null,
  });
const stockInclude = { category: true, balance: true };
const stockDTO = (
  r: Prisma.CatalogItemGetPayload<{ include: typeof stockInclude }>,
) =>
  stockV1Schema.parse({
    itemId: r.id,
    item: r,
    category: r.category,
    baseUnit: r.inventoryBaseUnit,
    quantity: r.balance?.quantity.toFixed() ?? '0',
    active: r.active,
  });
type Entry = {
  itemId: string;
  baseUnit: InventoryBaseUnit;
  type: MovementType;
  quantity: string;
  origin: 'PURCHASE' | 'MANUAL' | 'PRODUCTION';
  productionOperationId?: string;
  reference: string;
  reason: string;
  actorId: string;
  purchaseLineId?: string;
  reversesId?: string;
  operationId?: string;
};
@Injectable()
export class StockService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}
  async lockItems(tx: Prisma.TransactionClient, ids: string[]) {
    const unique = [...new Set(ids)].sort();
    const rows = await tx.$queryRaw<CatalogItem[]>(
      Prisma.sql`SELECT * FROM "CatalogItem" WHERE "id" IN (${Prisma.join(unique.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY "id" FOR UPDATE`,
    );
    if (rows.length !== unique.length)
      throw new PurchaseError(
        'ITEM_NOT_FOUND',
        404,
        'Uno de los artículos no existe.',
        ['itemId'],
      );
    return rows;
  }
  requireTracked(item: Pick<CatalogItem, 'active' | 'trackInventory'>) {
    if (!item.active)
      throw new PurchaseError(
        'INACTIVE_RESOURCE',
        409,
        'El artículo está archivado.',
        ['itemId'],
      );
    if (!item.trackInventory)
      throw new PurchaseError(
        'INVENTORY_NOT_TRACKED',
        409,
        'El artículo no controla existencias.',
        ['itemId'],
      );
  }
  // Caller holds ordered item locks. Balance and ledger always use the caller transaction.
  async record(tx: Prisma.TransactionClient, entry: Entry) {
    const quantity = new Prisma.Decimal(entry.quantity);
    const incoming =
      entry.type === 'PURCHASE_IN' ||
      entry.type === 'ADJUSTMENT_IN' ||
      entry.type === 'PRODUCTION_RETURN';
    await tx.inventoryBalance.upsert({
      where: { itemId: entry.itemId },
      create: { itemId: entry.itemId, quantity: '0' },
      update: {},
    });
    if (incoming) {
      const maximum = new Prisma.Decimal('99999999999999.9999999999');
      // Decimal subtraction needs 24 digits; use a local 80-digit constructor.
      const Exact = Prisma.Decimal.clone({ precision: 80 });
      const limit = new Exact(maximum.toFixed())
        .minus(entry.quantity)
        .toFixed();
      const r = await tx.inventoryBalance.updateMany({
        where: { itemId: entry.itemId, quantity: { lte: limit } },
        data: { quantity: { increment: quantity } },
      });
      if (r.count !== 1)
        throw new PurchaseError(
          'DECIMAL_OVERFLOW',
          409,
          'La existencia excedería la precisión permitida.',
        );
    } else {
      const r = await tx.inventoryBalance.updateMany({
        where: { itemId: entry.itemId, quantity: { gte: quantity } },
        data: { quantity: { decrement: quantity } },
      });
      if (r.count !== 1)
        throw new PurchaseError(
          'INSUFFICIENT_STOCK',
          409,
          'La operación dejaría existencias negativas.',
        );
    }
    return movementDTO(
      await tx.inventoryMovement.create({
        data: entry,
        include: movementInclude,
      }),
    );
  }
  async adjust(input: AdjustmentV1, actorId: string) {
    const data = parse(adjustmentV1Schema, input);
    try {
      return await this.db.$transaction(
        async (tx) => {
          if (
            await tx.inventoryMovement.findUnique({
              where: { operationId: data.operationId },
            })
          )
            throw new PurchaseError(
              'DUPLICATE_OPERATION',
              409,
              'Este ajuste ya fue registrado. Consulta el historial.',
            );
          const [item] = await this.lockItems(tx, [data.itemId]);
          this.requireTracked(item!);
          return this.record(tx, {
            ...data,
            baseUnit: item!.inventoryBaseUnit,
            origin: 'MANUAL',
            reference: data.operationId,
            actorId,
          });
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 10000,
        },
      );
    } catch (e) {
      databaseError(e);
    }
  }
  async stocks(q: StockFiltersV1) {
    const where: Prisma.CatalogItemWhereInput = {
      trackInventory: true,
      categoryId: q.categoryId,
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' as const } },
              { sku: { contains: q.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    try {
      const [rows, count] = await this.db.$transaction(
        [
          this.db.catalogItem.findMany({
            where,
            include: stockInclude,
            skip: (q.page - 1) * q.pageSize,
            take: q.pageSize,
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
          }),
          this.db.catalogItem.count({ where }),
        ],
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
      return { data: rows.map(stockDTO), pagination: pagination(q, count) };
    } catch (e) {
      databaseError(e);
    }
  }
  async stock(id: string) {
    try {
      const row = await this.db.catalogItem.findUnique({
        where: { id },
        include: stockInclude,
      });
      if (!row)
        throw new PurchaseError(
          'ITEM_NOT_FOUND',
          404,
          'El artículo no existe.',
        );
      if (!row.trackInventory)
        throw new PurchaseError(
          'INVENTORY_NOT_TRACKED',
          409,
          'El artículo no controla existencias.',
        );
      return stockDTO(row);
    } catch (e) {
      databaseError(e);
    }
  }
  async movements(q: MovementFiltersV1) {
    const where: Prisma.InventoryMovementWhereInput = {
      itemId: q.itemId,
      type: q.type,
      origin: q.origin,
      occurredAt: { gte: q.from, lte: q.to },
    };
    try {
      const [rows, count] = await this.db.$transaction(
        [
          this.db.inventoryMovement.findMany({
            where,
            include: movementInclude,
            skip: (q.page - 1) * q.pageSize,
            take: q.pageSize,
            orderBy: [{ occurredAt: 'desc' }, { id: 'asc' }],
          }),
          this.db.inventoryMovement.count({ where }),
        ],
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
      return { data: rows.map(movementDTO), pagination: pagination(q, count) };
    } catch (e) {
      databaseError(e);
    }
  }
}
