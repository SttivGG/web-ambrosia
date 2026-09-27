import { Inject, Injectable } from '@nestjs/common';
import {
  adjustmentV1Schema,
  initialValuationInputV1Schema,
  initialValuationV1Schema,
  movementV1Schema,
  stockV1Schema,
  type AdjustmentV1,
  type InitialValuationInputV1,
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
    unitCost: r.unitCost?.toFixed() ?? null,
    totalCost: r.totalCost?.toFixed() ?? null,
    inventoryValueAfter: r.inventoryValueAfter?.toFixed() ?? null,
    averageUnitCostAfter: r.averageUnitCostAfter?.toFixed() ?? null,
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
    valuationStatus:
      !r.balance || r.balance.quantity.isZero()
        ? 'EMPTY'
        : r.balance.inventoryValue === null
          ? 'UNVALUED'
          : 'VALUED',
    inventoryValue: r.balance?.inventoryValue?.toFixed() ?? null,
    averageUnitCost: r.balance?.averageUnitCost?.toFixed() ?? null,
    active: r.active,
  });
type Entry = {
  itemId: string;
  baseUnit: InventoryBaseUnit;
  type: MovementType;
  quantity: string;
  origin: 'PURCHASE' | 'MANUAL' | 'PRODUCTION' | 'SALE';
  productionOperationId?: string;
  saleOperationId?: string;
  reference: string;
  reason: string;
  actorId: string;
  purchaseLineId?: string;
  reversesId?: string;
  operationId?: string;
  totalCost?: string;
};
const Exact = Prisma.Decimal.clone({
  precision: 80,
  rounding: Prisma.Decimal.ROUND_HALF_UP,
});
const persistedCost = (value: Prisma.Decimal) =>
  value.toDecimalPlaces(18).toFixed();
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
    const quantity = new Exact(entry.quantity);
    const incoming =
      entry.type === 'PURCHASE_IN' ||
      entry.type === 'ADJUSTMENT_IN' ||
      entry.type === 'PRODUCTION_RETURN' ||
      entry.type === 'PRODUCTION_IN' ||
      entry.type === 'PACKAGED_PRODUCT_IN' ||
      entry.type === 'SALE_RETURN';
    const balance = await tx.inventoryBalance.upsert({
      where: { itemId: entry.itemId },
      create: { itemId: entry.itemId, quantity: '0', inventoryValue: '0' },
      update: {},
    });
    const currentQuantity = new Exact(balance.quantity.toFixed());
    const currentValue =
      balance.inventoryValue === null
        ? null
        : new Exact(balance.inventoryValue.toFixed());
    const nextQuantity = incoming
      ? currentQuantity.plus(quantity)
      : currentQuantity.minus(quantity);
    if (nextQuantity.lt(0))
      throw new PurchaseError(
        'INSUFFICIENT_STOCK',
        409,
        'La operación dejaría existencias negativas.',
      );
    if (nextQuantity.gte('100000000000000'))
      throw new PurchaseError(
        'DECIMAL_OVERFLOW',
        409,
        'La existencia excedería la precisión permitida.',
      );

    let movementCost: Prisma.Decimal | null =
      entry.totalCost === undefined ? null : new Exact(entry.totalCost);
    let nextValue: Prisma.Decimal | null = currentValue;
    let nextAverage: Prisma.Decimal | null = null;
    if (incoming) {
      if (
        movementCost === null &&
        currentValue !== null &&
        currentQuantity.gt(0)
      )
        movementCost = new Exact(balance.averageUnitCost!.toFixed()).mul(
          quantity,
        );
      if (movementCost !== null) {
        if (currentQuantity.gt(0) && currentValue === null)
          throw new PurchaseError(
            'INITIAL_VALUATION_REQUIRED',
            409,
            'Registra la valoración inicial antes de aplicar costos.',
            ['itemId'],
          );
        nextValue = (currentValue ?? new Exact(0)).plus(movementCost);
      } else if (currentQuantity.isZero()) {
        nextValue = null;
      }
    } else {
      if (currentValue === null || balance.averageUnitCost === null)
        throw new PurchaseError(
          'INITIAL_VALUATION_REQUIRED',
          409,
          'Registra la valoración inicial antes de consumir existencias.',
          ['itemId'],
        );
      movementCost ??= nextQuantity.isZero()
        ? currentValue
        : new Exact(balance.averageUnitCost.toFixed()).mul(quantity);
      if (movementCost.gt(currentValue))
        throw new PurchaseError(
          'DECIMAL_OVERFLOW',
          409,
          'El costo compensado excede el valor disponible.',
        );
      nextValue = currentValue.minus(movementCost);
    }
    if (nextQuantity.isZero()) {
      nextValue = new Exact(0);
      nextAverage = null;
    } else if (nextValue !== null) {
      nextAverage = nextValue.div(nextQuantity);
    }
    const storedValue = nextValue === null ? null : persistedCost(nextValue);
    const storedAverage =
      nextAverage === null ? null : persistedCost(nextAverage);
    await tx.inventoryBalance.update({
      where: { itemId: entry.itemId },
      data: {
        quantity: nextQuantity.toFixed(),
        inventoryValue: storedValue,
        averageUnitCost: storedAverage,
      },
    });
    return movementDTO(
      await tx.inventoryMovement.create({
        data: {
          ...entry,
          balanceAfter: nextQuantity.toFixed(),
          totalCost: movementCost === null ? null : persistedCost(movementCost),
          unitCost:
            movementCost === null
              ? null
              : persistedCost(movementCost.div(quantity)),
          inventoryValueAfter: storedValue,
          averageUnitCostAfter: storedAverage,
        },
        include: movementInclude,
      }),
    );
  }
  async initialValuation(input: InitialValuationInputV1, actorId: string) {
    const data = parse(initialValuationInputV1Schema, input);
    try {
      return await this.db.$transaction(
        async (tx) => {
          const duplicate = await tx.initialInventoryValuation.findUnique({
            where: { operationId: data.operationId },
          });
          if (duplicate) {
            if (
              duplicate.itemId !== data.itemId ||
              duplicate.actorId !== actorId ||
              duplicate.quantity.toFixed() !== data.quantity ||
              duplicate.unitCost.toFixed() !==
                new Exact(data.unitCost).toFixed() ||
              duplicate.occurredAt.toISOString() !== data.occurredAt ||
              duplicate.reason !== data.reason
            )
              throw new PurchaseError(
                'DUPLICATE_OPERATION',
                409,
                'El identificador pertenece a otra valoración.',
              );
            return initialValuationV1Schema.parse({
              ...duplicate,
              quantity: duplicate.quantity.toFixed(),
              unitCost: duplicate.unitCost.toFixed(),
              totalCost: duplicate.totalCost.toFixed(),
              occurredAt: duplicate.occurredAt.toISOString(),
              createdAt: duplicate.createdAt.toISOString(),
            });
          }
          const [item] = await this.lockItems(tx, [data.itemId]);
          this.requireTracked(item!);
          const balance = await tx.inventoryBalance.findUnique({
            where: { itemId: data.itemId },
          });
          if (
            !balance ||
            balance.quantity.isZero() ||
            balance.quantity.toFixed() !== data.quantity
          )
            throw new PurchaseError(
              'VALIDATION_ERROR',
              409,
              'La cantidad declarada debe coincidir con la existencia positiva actual.',
              ['quantity'],
            );
          if (balance.inventoryValue !== null)
            throw new PurchaseError(
              'DUPLICATE_OPERATION',
              409,
              'El artículo ya está valorado.',
            );
          const unitCost = new Exact(data.unitCost);
          const totalCost = unitCost.mul(data.quantity);
          const total = persistedCost(totalCost);
          const average = persistedCost(unitCost);
          await tx.inventoryBalance.update({
            where: { itemId: data.itemId },
            data: { inventoryValue: total, averageUnitCost: average },
          });
          const row = await tx.initialInventoryValuation.create({
            data: {
              ...data,
              unitCost: average,
              totalCost: total,
              occurredAt: new Date(data.occurredAt),
              actorId,
            },
          });
          return initialValuationV1Schema.parse({
            ...row,
            quantity: row.quantity.toFixed(),
            unitCost: row.unitCost.toFixed(),
            totalCost: row.totalCost.toFixed(),
            occurredAt: row.occurredAt.toISOString(),
            createdAt: row.createdAt.toISOString(),
          });
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 10000,
        },
      );
    } catch (error) {
      databaseError(error);
    }
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
