import { z } from 'zod';
import {
  BASE_UNITS_V1,
  decimalV1Schema,
  paginationV1Schema,
  categoryFiltersV1Schema,
  versionV1Schema,
} from './catalog-v1';
export const PURCHASE_STATUSES_V1 = ['DRAFT', 'RECEIVED', 'CANCELLED'] as const;
export const MOVEMENT_TYPES_V1 = [
  'PURCHASE_IN',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
  'REVERSAL',
  'PRODUCTION_OUT',
  'PRODUCTION_RETURN',
  'PRODUCTION_IN',
  'PACKAGING_OUT',
  'PACKAGED_PRODUCT_IN',
] as const;
export const quantityV1Schema = decimalV1Schema.refine(
  (v) => /[1-9]/.test(v),
  'La cantidad debe ser mayor que cero.',
);
export const moneyV1Schema = z
  .string()
  .regex(
    /^(0|[1-9]\d{0,21})(\.\d{1,2})?$/,
    'Usa hasta 22 enteros y dos decimales.',
  );
export const purchaseLineInputV1Schema = z
  .object({
    itemId: z.string().uuid(),
    quantity: quantityV1Schema,
    unitCost: moneyV1Schema,
  })
  .strict();
export const createPurchaseV1Schema = z
  .object({
    supplierId: z.string().uuid(),
    reference: z.string().trim().toUpperCase().min(1).max(80),
    purchasedAt: z.string().datetime(),
    notes: z.string().trim().max(2000).nullable().optional(),
    lines: z
      .array(purchaseLineInputV1Schema)
      .min(1)
      .max(50)
      .refine(
        (v) => new Set(v.map((l) => l.itemId)).size === v.length,
        'No repitas artículos.',
      ),
  })
  .strict();
export const updatePurchaseV1Schema = createPurchaseV1Schema
  .extend(versionV1Schema.shape)
  .strict();
export const cancelPurchaseV1Schema = versionV1Schema
  .extend({ reason: z.string().trim().min(3).max(500) })
  .strict();
const paging = categoryFiltersV1Schema.pick({ page: true, pageSize: true });
const dateRange = {
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
};
const orderedDates = (v: { from?: string; to?: string }) =>
  !v.from || !v.to || Date.parse(v.from) <= Date.parse(v.to);
export const purchaseFiltersV1Schema = paging
  .extend({
    supplierId: z.string().uuid().optional(),
    status: z.enum(PURCHASE_STATUSES_V1).optional(),
    reference: z.string().trim().max(80).optional(),
    ...dateRange,
  })
  .strict()
  .refine(orderedDates, 'El inicio debe ser anterior al fin.');
export const movementFiltersV1Schema = paging
  .extend({
    itemId: z.string().uuid().optional(),
    type: z.enum(MOVEMENT_TYPES_V1).optional(),
    origin: z.enum(['PURCHASE', 'MANUAL', 'PRODUCTION']).optional(),
    ...dateRange,
  })
  .strict()
  .refine(orderedDates, 'El inicio debe ser anterior al fin.');
export const stockFiltersV1Schema = paging
  .extend({
    search: z.string().trim().max(120).optional(),
    categoryId: z.string().uuid().optional(),
  })
  .strict();
export const adjustmentV1Schema = z
  .object({
    itemId: z.string().uuid(),
    type: z.enum(['ADJUSTMENT_IN', 'ADJUSTMENT_OUT']),
    quantity: quantityV1Schema,
    reason: z.string().trim().min(3).max(500),
    operationId: z.string().uuid(),
  })
  .strict();
const itemSummary = z.object({
  id: z.string().uuid(),
  sku: z.string(),
  name: z.string(),
});
export const purchaseV1Schema = z.object({
  id: z.string().uuid(),
  supplierId: z.string().uuid(),
  supplier: z.object({
    id: z.string().uuid(),
    code: z.string(),
    name: z.string(),
  }),
  reference: z.string(),
  purchasedAt: z.string().datetime(),
  status: z.enum(PURCHASE_STATUSES_V1),
  notes: z.string().nullable(),
  subtotal: moneyV1Schema,
  total: moneyV1Schema,
  currency: z.literal('COP'),
  version: z.number().int().positive(),
  receivedAt: z.string().datetime().nullable(),
  cancelledAt: z.string().datetime().nullable(),
  cancellationReason: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lines: z.array(
    purchaseLineInputV1Schema.extend({
      id: z.string().uuid(),
      subtotal: moneyV1Schema,
      baseUnit: z.enum(BASE_UNITS_V1),
      item: itemSummary,
    }),
  ),
});
export const movementV1Schema = z.object({
  id: z.string().uuid(),
  itemId: z.string().uuid(),
  item: itemSummary,
  type: z.enum(MOVEMENT_TYPES_V1),
  quantity: quantityV1Schema,
  baseUnit: z.enum(BASE_UNITS_V1),
  origin: z.enum(['PURCHASE', 'MANUAL', 'PRODUCTION']),
  reference: z.string(),
  reason: z.string(),
  actorId: z.string().uuid(),
  occurredAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  purchaseId: z.string().uuid().nullable(),
  purchaseLineId: z.string().uuid().nullable(),
  reversesId: z.string().uuid().nullable(),
  operationId: z.string().uuid().nullable(),
});
export const stockV1Schema = z.object({
  itemId: z.string().uuid(),
  item: itemSummary,
  category: z.object({ id: z.string().uuid(), name: z.string() }),
  baseUnit: z.enum(BASE_UNITS_V1),
  quantity: decimalV1Schema,
  active: z.boolean(),
});
export const purchaseListV1Schema = z.object({
  data: z.array(purchaseV1Schema),
  pagination: paginationV1Schema,
});
export const movementListV1Schema = z.object({
  data: z.array(movementV1Schema),
  pagination: paginationV1Schema,
});
export const stockListV1Schema = z.object({
  data: z.array(stockV1Schema),
  pagination: paginationV1Schema,
});
export const PURCHASE_ERROR_CODES_V1 = [
  'VALIDATION_ERROR',
  'PURCHASE_NOT_FOUND',
  'SUPPLIER_NOT_FOUND',
  'ITEM_NOT_FOUND',
  'INVALID_PURCHASE_STATE',
  'INACTIVE_RESOURCE',
  'ITEM_NOT_ASSOCIATED',
  'INVENTORY_NOT_TRACKED',
  'CONCURRENT_MODIFICATION',
  'DUPLICATE_OPERATION',
  'INSUFFICIENT_STOCK',
  'DECIMAL_OVERFLOW',
  'PURCHASE_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;
export const purchaseErrorV1Schema = z.object({
  code: z.enum(PURCHASE_ERROR_CODES_V1),
  message: z.string(),
  fields: z.array(z.string()).optional(),
});
export type CreatePurchaseV1 = z.infer<typeof createPurchaseV1Schema>;
export type UpdatePurchaseV1 = z.infer<typeof updatePurchaseV1Schema>;
export type PurchaseV1 = z.infer<typeof purchaseV1Schema>;
export type PurchaseFiltersV1 = z.infer<typeof purchaseFiltersV1Schema>;
export type MovementFiltersV1 = z.infer<typeof movementFiltersV1Schema>;
export type StockFiltersV1 = z.infer<typeof stockFiltersV1Schema>;
export type AdjustmentV1 = z.infer<typeof adjustmentV1Schema>;
export type MovementV1 = z.infer<typeof movementV1Schema>;
export type StockV1 = z.infer<typeof stockV1Schema>;
