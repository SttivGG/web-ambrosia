import { z } from 'zod';
import { BASE_UNITS_V1, ITEM_TYPES_V1, paginationV1Schema } from './catalog-v1';
import { MOVEMENT_TYPES_V1, costDecimalV1Schema } from './purchase-v1';

export const REPORTING_SUBJECTS_V1 = {
  inventory: 'inventory.reporting.v1',
  production: 'production.reporting.v1',
  finance: 'finance.reporting.v1',
} as const;

const id = z.string().uuid();
const quantity = z.string().regex(/^-?(0|[1-9]\d{0,13})(\.\d{1,10})?$/);
const nullableCost = costDecimalV1Schema.nullable();
const eventMetadata = {
  eventId: id,
  sourceEntityId: id,
  sourceVersion: z.number().int().nonnegative(),
  operationId: id.nullable(),
  occurredAt: z.string().datetime(),
};

export const reportPurchaseItemSnapshotV1Schema = z
  .object({
    ...eventMetadata,
    kind: z.literal('PURCHASE_ITEM_SNAPSHOT'),
    sourceService: z.literal('inventory-service'),
    purchaseId: id,
    purchaseLineId: id,
    purchaseReference: z.string().min(1).max(80),
    purchasedAt: z.string().datetime(),
    supplierId: id,
    supplierNameSnapshot: z.string().min(1).max(160),
    itemId: id,
    itemNameSnapshot: z.string().min(1).max(120),
    categoryId: id,
    categoryNameSnapshot: z.string().min(1).max(80),
    quantity,
    unit: z.enum(BASE_UNITS_V1),
    unitCost: costDecimalV1Schema,
    subtotal: costDecimalV1Schema,
    status: z.enum(['DRAFT', 'RECEIVED', 'CANCELLED']),
  })
  .strict();

const reportInventoryItemSnapshotBaseV1Schema = z
  .object({
    ...eventMetadata,
    kind: z.literal('ITEM_SNAPSHOT'),
    sourceService: z.literal('inventory-service'),
    itemId: id,
    itemNameSnapshot: z.string().min(1).max(120),
    itemType: z.enum(ITEM_TYPES_V1),
    unit: z.enum(BASE_UNITS_V1),
    onHand: quantity,
    valuationStatus: z.enum(['VALUED', 'UNVALUED', 'EMPTY']),
    weightedAverageCost: nullableCost,
    inventoryValue: nullableCost,
    active: z.boolean(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export const reportInventoryItemSnapshotV1Schema =
  reportInventoryItemSnapshotBaseV1Schema.superRefine((value, context) => {
    if (
      value.valuationStatus === 'UNVALUED' &&
      (value.weightedAverageCost !== null || value.inventoryValue !== null)
    )
      context.addIssue({
        code: 'custom',
        path: ['valuationStatus'],
        message: 'UNVALUED no admite costos inventados.',
      });
  });

export const reportInventoryMovementSnapshotV1Schema = z
  .object({
    ...eventMetadata,
    kind: z.literal('MOVEMENT'),
    sourceService: z.literal('inventory-service'),
    movementId: id,
    itemId: id,
    itemNameSnapshot: z.string().min(1).max(120),
    movementType: z.enum(MOVEMENT_TYPES_V1),
    reference: z.string().min(1).max(120),
    quantityIn: quantity,
    quantityOut: quantity,
    balanceAfter: quantity.nullable(),
    unitCost: nullableCost,
    totalCost: nullableCost,
    averageCostAfter: nullableCost,
  })
  .strict();

export const inventoryReportingEventV1Schema = z.discriminatedUnion('kind', [
  reportInventoryItemSnapshotV1Schema,
  reportInventoryMovementSnapshotV1Schema,
  reportPurchaseItemSnapshotV1Schema,
]);

export const reportProductionBatchSnapshotV1Schema = z
  .object({
    ...eventMetadata,
    kind: z.literal('BATCH_SNAPSHOT'),
    sourceService: z.literal('production-service'),
    batchId: id,
    batch: z.string().min(1).max(80),
    productId: id,
    productNameSnapshot: z.string().max(120).nullable(),
    status: z.enum(['DRAFT', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']),
    startedAt: z.string().datetime().nullable(),
    completedAt: z.string().datetime().nullable(),
    inputQuantity: quantity,
    outputQuantity: quantity.nullable(),
    yieldPercentage: quantity.nullable(),
    wasteQuantity: quantity.nullable(),
    accumulatedCost: nullableCost,
    sellableCost: nullableCost,
    packagingOutputQuantity: quantity.nullable(),
  })
  .strict();

export const reportPackagingOperationSnapshotV1Schema = z
  .object({
    ...eventMetadata,
    kind: z.literal('PACKAGING_SNAPSHOT'),
    sourceService: z.literal('production-service'),
    packagingOperationId: id,
    batchId: id,
    batch: z.string().min(1).max(80),
    finishedProductId: id,
    units: quantity,
    netContentPerUnit: quantity,
    netContentTotal: quantity,
    unit: z.string().min(1).max(20),
    bulkCost: nullableCost,
    materialsCost: nullableCost,
    totalCost: nullableCost,
    finishedUnitCost: nullableCost,
    status: z.enum(['PENDING', 'CONFIRMED', 'REJECTED']),
    packagedAt: z.string().datetime(),
  })
  .strict();

export const productionReportingEventV1Schema = z.discriminatedUnion('kind', [
  reportProductionBatchSnapshotV1Schema,
  reportPackagingOperationSnapshotV1Schema,
]);

export const financeReportingEventV1Schema = z
  .object({
    ...eventMetadata,
    kind: z.literal('SALE_MARGIN_SNAPSHOT'),
    sourceService: z.literal('finance-reporting-service'),
    saleId: id,
    saleLineId: id,
    status: z.enum(['CONFIRMED', 'CANCELLED']),
    productId: id,
    productNameSnapshot: z.string().min(1).max(120),
    quantity: quantity,
    revenue: costDecimalV1Schema,
    cogs: nullableCost,
    grossMargin: z
      .string()
      .regex(/^-?(0|[1-9]\d{0,29})(\.\d{1,18})?$/)
      .nullable(),
    grossMarginPercent: z
      .string()
      .regex(/^-?(0|[1-9]\d{0,21})(\.\d{1,10})?$/)
      .nullable(),
  })
  .strict();

const paging = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
const range = {
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
};
const orderedRange = (value: { from?: string; to?: string }) =>
  !value.from || !value.to || Date.parse(value.from) < Date.parse(value.to);
export const reportInventoryFiltersV1Schema = paging
  .extend({
    search: z.string().trim().max(120).optional(),
    itemType: z.enum(ITEM_TYPES_V1).optional(),
    valuationStatus: z.enum(['VALUED', 'UNVALUED', 'EMPTY']).optional(),
    ...range,
  })
  .strict()
  .refine(orderedRange, 'El rango debe cumplir [from, to).');
export const reportMovementFiltersV1Schema = paging
  .extend({
    itemId: id.optional(),
    movementType: z.enum(MOVEMENT_TYPES_V1).optional(),
    reference: z.string().trim().max(120).optional(),
    operationId: id.optional(),
    ...range,
  })
  .strict()
  .refine(orderedRange, 'El rango debe cumplir [from, to).');
export const reportProductionFiltersV1Schema = paging
  .extend({
    status: z
      .enum(['DRAFT', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'])
      .optional(),
    productId: id.optional(),
    ...range,
  })
  .strict()
  .refine(orderedRange, 'El rango debe cumplir [from, to).');
export const reportFinanceFiltersV1Schema = paging
  .extend({
    productId: id.optional(),
    status: z.enum(['CONFIRMED', 'CANCELLED']).optional(),
    ...range,
  })
  .strict()
  .refine(orderedRange, 'El rango debe cumplir [from, to).');
export const reportPurchaseFiltersV1Schema = paging
  .extend({
    supplierId: id.optional(),
    itemId: id.optional(),
    categoryId: id.optional(),
    status: z.enum(['DRAFT', 'RECEIVED', 'CANCELLED']).optional(),
    ...range,
  })
  .strict()
  .refine(orderedRange, 'El rango debe cumplir [from, to).');
export const reportSupplierFiltersV1Schema = paging
  .extend({
    search: z.string().trim().max(160).optional(),
    ...range,
  })
  .strict()
  .refine(orderedRange, 'El rango debe cumplir [from, to).');
export const reportPackagingFiltersV1Schema = paging
  .extend({
    productId: id.optional(),
    status: z.enum(['PENDING', 'CONFIRMED', 'REJECTED']).optional(),
    ...range,
  })
  .strict()
  .refine(orderedRange, 'El rango debe cumplir [from, to).');

const projectionMetadata = z.object({
  sourceService: z.string(),
  sourceEntityId: id,
  sourceVersion: z.number().int().nonnegative(),
  operationId: id.nullable(),
  eventId: id,
  occurredAt: z.string().datetime(),
  processedAt: z.string().datetime(),
});
export const reportInventoryItemV1Schema =
  reportInventoryItemSnapshotBaseV1Schema
    .omit({ kind: true })
    .merge(projectionMetadata);
export const reportInventoryMovementV1Schema =
  reportInventoryMovementSnapshotV1Schema
    .omit({ kind: true })
    .merge(projectionMetadata);
export const reportPurchaseItemV1Schema = reportPurchaseItemSnapshotV1Schema
  .omit({ kind: true })
  .merge(projectionMetadata)
  .extend({ unitCost: nullableCost, subtotal: nullableCost });
export const reportProductionBatchV1Schema =
  reportProductionBatchSnapshotV1Schema
    .omit({ kind: true })
    .merge(projectionMetadata);
export const reportPackagingOperationV1Schema =
  reportPackagingOperationSnapshotV1Schema
    .omit({ kind: true })
    .merge(projectionMetadata);
export const reportSaleMarginV1Schema = financeReportingEventV1Schema
  .omit({ kind: true })
  .merge(projectionMetadata);
export const reportInventoryListV1Schema = z.object({
  data: z.array(reportInventoryItemV1Schema),
  pagination: paginationV1Schema,
});
export const reportMovementListV1Schema = z.object({
  data: z.array(reportInventoryMovementV1Schema),
  pagination: paginationV1Schema,
});
export const reportProductionListV1Schema = z.object({
  data: z.array(reportProductionBatchV1Schema),
  pagination: paginationV1Schema,
});
export const reportFinanceListV1Schema = z.object({
  data: z.array(reportSaleMarginV1Schema),
  pagination: paginationV1Schema,
});
export const reportPurchaseListV1Schema = z.object({
  data: z.array(reportPurchaseItemV1Schema),
  pagination: paginationV1Schema,
});
export const reportSupplierV1Schema = z.object({
  supplierId: id,
  supplierName: z.string(),
  totalPurchases: nullableCost,
  purchaseCount: z.number().int().nonnegative(),
  lastPurchaseAt: z.string().datetime().nullable(),
  suppliedItems: z.number().int().nonnegative(),
  averageCosts: z.array(
    z.object({
      itemId: id,
      itemName: z.string(),
      weightedAverageCost: nullableCost,
    }),
  ),
  priceHistory: z.array(
    z.object({
      itemId: id,
      itemName: z.string(),
      purchasedAt: z.string().datetime(),
      unitCost: nullableCost,
    }),
  ),
});
export const reportSupplierListV1Schema = z.object({
  data: z.array(reportSupplierV1Schema),
  pagination: paginationV1Schema,
});
export const reportPackagingListV1Schema = z.object({
  data: z.array(reportPackagingOperationV1Schema),
  pagination: paginationV1Schema,
});
export const reportSummaryV1Schema = z.object({
  metrics: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
  comparison: z
    .record(
      z.string(),
      z.object({
        current: z.string().nullable(),
        previous: z.string().nullable(),
        changePercent: z.string().nullable(),
      }),
    )
    .optional(),
});
export const inventoryReconciliationPageV1Schema = z.object({
  items: z.array(reportInventoryItemSnapshotV1Schema),
  movements: z.array(reportInventoryMovementSnapshotV1Schema),
  purchases: z.array(reportPurchaseItemSnapshotV1Schema),
  pagination: paginationV1Schema,
});
export const productionReconciliationPageV1Schema = z.object({
  batches: z.array(reportProductionBatchSnapshotV1Schema),
  packaging: z.array(reportPackagingOperationSnapshotV1Schema),
  pagination: paginationV1Schema,
});
export const reportingSnapshotQueryV1Schema = paging.strict();
export const reportHealthV1Schema = z.object({
  status: z.enum(['ok', 'unavailable']),
  timestamp: z.string().datetime(),
  projections: z.object({
    inventoryItems: z.number().int().nonnegative(),
    inventoryMovements: z.number().int().nonnegative(),
    productionBatches: z.number().int().nonnegative(),
    saleMargins: z.number().int().nonnegative(),
    purchaseItems: z.number().int().nonnegative(),
    packagingOperations: z.number().int().nonnegative(),
  }),
});

export type InventoryReportingEventV1 = z.infer<
  typeof inventoryReportingEventV1Schema
>;
export type ProductionReportingEventV1 = z.infer<
  typeof productionReportingEventV1Schema
>;
export type FinanceReportingEventV1 = z.infer<
  typeof financeReportingEventV1Schema
>;
export type ReportInventoryFiltersV1 = z.infer<
  typeof reportInventoryFiltersV1Schema
>;
export type ReportMovementFiltersV1 = z.infer<
  typeof reportMovementFiltersV1Schema
>;
export type ReportProductionFiltersV1 = z.infer<
  typeof reportProductionFiltersV1Schema
>;
export type ReportFinanceFiltersV1 = z.infer<
  typeof reportFinanceFiltersV1Schema
>;
export type ReportPurchaseFiltersV1 = z.infer<
  typeof reportPurchaseFiltersV1Schema
>;
export type ReportSupplierFiltersV1 = z.infer<
  typeof reportSupplierFiltersV1Schema
>;
export type ReportPackagingFiltersV1 = z.infer<
  typeof reportPackagingFiltersV1Schema
>;
export type ReportingSnapshotQueryV1 = z.infer<
  typeof reportingSnapshotQueryV1Schema
>;
export type ReportHealthV1 = z.infer<typeof reportHealthV1Schema>;
export type ReportInventoryListV1 = z.infer<typeof reportInventoryListV1Schema>;
export type ReportPurchaseListV1 = z.infer<typeof reportPurchaseListV1Schema>;
export type ReportSupplierListV1 = z.infer<typeof reportSupplierListV1Schema>;
export type ReportPackagingListV1 = z.infer<typeof reportPackagingListV1Schema>;
