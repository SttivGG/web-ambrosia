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
]);

export const productionReportingEventV1Schema = z
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
export const reportProductionBatchV1Schema = productionReportingEventV1Schema
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
export const inventoryReconciliationPageV1Schema = z.object({
  items: z.array(reportInventoryItemSnapshotV1Schema),
  movements: z.array(reportInventoryMovementSnapshotV1Schema),
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
export type ReportingSnapshotQueryV1 = z.infer<
  typeof reportingSnapshotQueryV1Schema
>;
export type ReportHealthV1 = z.infer<typeof reportHealthV1Schema>;
export type ReportInventoryListV1 = z.infer<typeof reportInventoryListV1Schema>;
