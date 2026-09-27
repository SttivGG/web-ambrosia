import { createHash } from 'node:crypto';
import {
  reportInventoryItemSnapshotV1Schema,
  reportInventoryMovementSnapshotV1Schema,
} from '@ambrosia/contracts';
import type { Prisma } from '../generated/prisma/client';

export const deterministicEventId = (value: string) => {
  const bytes = createHash('sha256').update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
};

type Item = Prisma.CatalogItemGetPayload<{ include: { balance: true } }>;
type Movement = Prisma.InventoryMovementGetPayload<{ include: { item: true } }>;

export const itemSnapshot = (row: Item) => {
  const updatedAt =
    row.balance && row.balance.updatedAt > row.updatedAt
      ? row.balance.updatedAt
      : row.updatedAt;
  const version = updatedAt.getTime();
  const valuationStatus =
    !row.balance || row.balance.quantity.isZero()
      ? 'EMPTY'
      : row.balance.inventoryValue === null
        ? 'UNVALUED'
        : 'VALUED';
  return reportInventoryItemSnapshotV1Schema.parse({
    kind: 'ITEM_SNAPSHOT',
    sourceService: 'inventory-service',
    sourceEntityId: row.id,
    sourceVersion: version,
    operationId: null,
    eventId: deterministicEventId(`inventory:item:${row.id}:${version}`),
    occurredAt: updatedAt.toISOString(),
    itemId: row.id,
    itemNameSnapshot: row.name,
    itemType: row.itemType,
    unit: row.inventoryBaseUnit,
    onHand: row.balance?.quantity.toFixed() ?? '0',
    valuationStatus,
    weightedAverageCost: row.balance?.averageUnitCost?.toFixed() ?? null,
    inventoryValue: row.balance?.inventoryValue?.toFixed() ?? null,
    active: row.active,
    updatedAt: updatedAt.toISOString(),
  });
};

export const movementSnapshot = (row: Movement) => {
  const incoming = [
    'PURCHASE_IN',
    'ADJUSTMENT_IN',
    'PRODUCTION_RETURN',
    'PRODUCTION_IN',
    'PACKAGED_PRODUCT_IN',
    'SALE_RETURN',
  ].includes(row.type);
  return reportInventoryMovementSnapshotV1Schema.parse({
    kind: 'MOVEMENT',
    sourceService: 'inventory-service',
    sourceEntityId: row.id,
    sourceVersion: row.createdAt.getTime(),
    operationId: row.operationId,
    eventId: row.id,
    occurredAt: row.occurredAt.toISOString(),
    movementId: row.id,
    itemId: row.itemId,
    itemNameSnapshot: row.item.name,
    movementType: row.type,
    reference: row.reference,
    quantityIn: incoming ? row.quantity.toFixed() : '0',
    quantityOut: incoming ? '0' : row.quantity.toFixed(),
    balanceAfter: row.balanceAfter?.toFixed() ?? null,
    unitCost: row.unitCost?.toFixed() ?? null,
    totalCost: row.totalCost?.toFixed() ?? null,
    averageCostAfter: row.averageUnitCostAfter?.toFixed() ?? null,
  });
};
