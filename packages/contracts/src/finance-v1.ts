import { z } from 'zod';
import {
  categoryFiltersV1Schema,
  paginationV1Schema,
  versionV1Schema,
} from './catalog-v1';
import { moneyV1Schema } from './purchase-v1';
export const ACCOUNT_TYPES_V1 = ['CASH', 'BANK', 'OTHER'] as const;
export const PAYMENT_METHODS_V1 = [
  'CASH',
  'BANK_TRANSFER',
  'CARD',
  'OTHER',
] as const;
export const FINANCE_MOVEMENT_KINDS_V1 = [
  'ADDITIONAL_INCOME',
  'EXPENSE',
  'PURCHASE_PAYMENT',
  'SALE_INCOME',
  'SALE_REFUND',
] as const;
export const SALE_STATUSES_V1 = [
  'PENDING',
  'CONFIRMED',
  'REJECTED',
  'CANCELLATION_PENDING',
  'CANCELLED',
] as const;
export const SALE_OPERATION_STATUSES_V1 = [
  'PENDING',
  'CONFIRMED',
  'REJECTED',
] as const;
export const FINANCE_ERROR_CODES_V1 = [
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'INACTIVE_ACCOUNT',
  'INVALID_STATE',
  'CONCURRENT_MODIFICATION',
  'DUPLICATE_OPERATION',
  'PURCHASE_NOT_PAYABLE',
  'PURCHASE_OVERPAYMENT',
  'INVENTORY_UNAVAILABLE',
  'DECIMAL_OVERFLOW',
  'FINANCE_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;
const id = z.string().uuid();
const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable();
const positiveMoney = moneyV1Schema.refine(
  (value) => /[1-9]/.test(value),
  'El importe debe ser mayor que cero.',
);
const signedMoney = z.string().regex(/^-?(0|[1-9]\d{0,21})(\.\d{1,2})?$/);
const paging = categoryFiltersV1Schema.pick({ page: true, pageSize: true });
const dateRange = {
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
};
const orderedDates = (value: { from?: string; to?: string }) =>
  !value.from || !value.to || Date.parse(value.from) <= Date.parse(value.to);
export const financeErrorV1Schema = z.object({
  code: z.enum(FINANCE_ERROR_CODES_V1),
  message: z.string(),
  fields: z.array(z.string()).optional(),
});
export const createMoneyAccountV1Schema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9_-]{2,39}$/),
    name: z.string().trim().min(2).max(120),
    type: z.enum(ACCOUNT_TYPES_V1),
    description: nullableText(500).optional(),
  })
  .strict();
export const updateMoneyAccountV1Schema = createMoneyAccountV1Schema
  .omit({ code: true })
  .partial()
  .extend(versionV1Schema.shape)
  .strict();
export const accountVersionV1Schema = versionV1Schema;
export const accountFiltersV1Schema = paging
  .extend({
    search: z.string().trim().max(120).optional(),
    active: z.enum(['true', 'false']).optional(),
  })
  .strict();
export const manualMovementInputV1Schema = z
  .object({
    operationId: id,
    accountId: id,
    kind: z.enum(['ADDITIONAL_INCOME', 'EXPENSE']),
    amount: positiveMoney,
    paymentMethod: z.enum(PAYMENT_METHODS_V1),
    occurredAt: z.string().datetime(),
    reference: nullableText(120).optional(),
    description: z.string().trim().min(3).max(500),
  })
  .strict();
export const purchasePaymentInputV1Schema = z
  .object({
    operationId: id,
    purchaseId: id,
    accountId: id,
    amount: positiveMoney,
    paymentMethod: z.enum(PAYMENT_METHODS_V1),
    occurredAt: z.string().datetime(),
    reference: nullableText(120).optional(),
    description: nullableText(500).optional(),
  })
  .strict();
export const regularizePaymentV1Schema = z
  .object({ note: z.string().trim().min(3).max(500) })
  .strict();
export const saleLineInputV1Schema = z
  .object({
    itemId: id,
    quantity: z.string().regex(/^[1-9]\d{0,8}$/),
    unitPrice: positiveMoney,
  })
  .strict();
export const createSaleV1Schema = z
  .object({
    operationId: id,
    accountId: id,
    paymentMethod: z.enum(PAYMENT_METHODS_V1),
    occurredAt: z.string().datetime(),
    reference: nullableText(120).optional(),
    description: nullableText(500).optional(),
    lines: z
      .array(saleLineInputV1Schema)
      .min(1)
      .max(50)
      .refine(
        (lines) =>
          new Set(lines.map((line) => line.itemId)).size === lines.length,
        'No repitas artículos.',
      ),
  })
  .strict();
export const cancelSaleV1Schema = versionV1Schema
  .extend({ operationId: id, reason: z.string().trim().min(3).max(500) })
  .strict();
export const financeMovementFiltersV1Schema = paging
  .extend({
    accountId: id.optional(),
    kind: z.enum(FINANCE_MOVEMENT_KINDS_V1).optional(),
    search: z.string().trim().max(120).optional(),
    ...dateRange,
  })
  .strict()
  .refine(orderedDates, 'El inicio debe ser anterior al fin.');
export const paymentFiltersV1Schema = paging
  .extend({
    purchaseId: id.optional(),
    discrepancy: z.enum(['true', 'false']).optional(),
    ...dateRange,
  })
  .strict()
  .refine(orderedDates, 'El inicio debe ser anterior al fin.');
export const saleFiltersV1Schema = paging
  .extend({
    status: z.enum(SALE_STATUSES_V1).optional(),
    search: z.string().trim().max(120).optional(),
    ...dateRange,
  })
  .strict()
  .refine(orderedDates, 'El inicio debe ser anterior al fin.');
export const moneyAccountV1Schema = z.object({
  id,
  code: z.string(),
  name: z.string(),
  type: z.enum(ACCOUNT_TYPES_V1),
  description: z.string().nullable(),
  active: z.boolean(),
  currency: z.literal('COP'),
  balance: signedMoney,
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  archivedAt: z.string().datetime().nullable(),
});
export const moneyAccountListV1Schema = z.object({
  data: z.array(moneyAccountV1Schema),
  pagination: paginationV1Schema,
});
export const financeMovementV1Schema = z.object({
  id,
  operationId: id,
  accountId: id,
  account: z.object({ id, code: z.string(), name: z.string() }),
  kind: z.enum(FINANCE_MOVEMENT_KINDS_V1),
  direction: z.enum(['CREDIT', 'DEBIT']),
  amount: positiveMoney,
  currency: z.literal('COP'),
  status: z.literal('CONFIRMED'),
  paymentMethod: z.enum(PAYMENT_METHODS_V1),
  occurredAt: z.string().datetime(),
  reference: z.string().nullable(),
  description: z.string(),
  actorId: id,
  purchasePaymentId: id.nullable(),
  saleId: id.nullable(),
  reversesId: id.nullable(),
  createdAt: z.string().datetime(),
});
export const financeMovementListV1Schema = z.object({
  data: z.array(financeMovementV1Schema),
  pagination: paginationV1Schema,
});
export const purchaseSnapshotV1Schema = z.object({
  id,
  reference: z.string(),
  status: z.enum(['DRAFT', 'RECEIVED', 'CANCELLED']),
  total: moneyV1Schema,
  currency: z.literal('COP'),
  supplier: z.object({ id, code: z.string(), name: z.string() }),
  purchasedAt: z.string().datetime(),
  receivedAt: z.string().datetime().nullable(),
  version: z.number().int().positive(),
});
export const purchasePaymentV1Schema = z.object({
  id,
  operationId: id,
  purchaseId: id,
  accountId: id,
  movementId: id,
  amount: positiveMoney,
  currency: z.literal('COP'),
  paymentMethod: z.enum(PAYMENT_METHODS_V1),
  occurredAt: z.string().datetime(),
  reference: z.string().nullable(),
  description: z.string().nullable(),
  actorId: id,
  purchaseSnapshot: purchaseSnapshotV1Schema,
  discrepancy: z.boolean(),
  discrepancyReason: z.string().nullable(),
  checkedAt: z.string().datetime().nullable(),
  regularizedAt: z.string().datetime().nullable(),
  regularizationNote: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export const purchasePaymentListV1Schema = z.object({
  data: z.array(purchasePaymentV1Schema),
  pagination: paginationV1Schema,
});
export const saleInventoryLineV1Schema = z.object({
  itemId: id,
  quantity: z.string().regex(/^[1-9]\d{0,8}$/),
});
export const saleStockRequestV1Schema = z.discriminatedUnion('kind', [
  z
    .object({
      operationId: id,
      saleId: id,
      kind: z.literal('CONFIRM'),
      actorId: id,
      reason: z.string().min(3).max(500),
      lines: z.array(saleInventoryLineV1Schema).min(1).max(50),
    })
    .strict(),
  z
    .object({
      operationId: id,
      saleId: id,
      kind: z.literal('CANCEL'),
      actorId: id,
      reason: z.string().min(3).max(500),
      originalOperationId: id,
      lines: z.array(saleInventoryLineV1Schema).min(1).max(50),
    })
    .strict(),
]);
export const saleStockResultV1Schema = z.object({
  operationId: id,
  saleId: id,
  status: z.enum(['CONFIRMED', 'REJECTED']),
  error: z.string().nullable(),
  movements: z.array(id),
});
export const saleableItemV1Schema = z.object({
  id,
  sku: z.string(),
  name: z.string(),
  active: z.boolean(),
  availableQuantity: z.string(),
});
export const saleableItemListV1Schema = z.object({
  data: z.array(saleableItemV1Schema),
  pagination: paginationV1Schema,
});
export const saleableItemFiltersV1Schema = paging
  .extend({ search: z.string().trim().max(120).optional() })
  .strict();
export const saleV1Schema = z.object({
  id,
  accountId: id,
  account: z.object({ id, code: z.string(), name: z.string() }),
  status: z.enum(SALE_STATUSES_V1),
  subtotal: moneyV1Schema,
  total: moneyV1Schema,
  currency: z.literal('COP'),
  paymentMethod: z.enum(PAYMENT_METHODS_V1),
  occurredAt: z.string().datetime(),
  reference: z.string().nullable(),
  description: z.string().nullable(),
  actorId: id,
  version: z.number().int().positive(),
  confirmedAt: z.string().datetime().nullable(),
  cancelledAt: z.string().datetime().nullable(),
  cancellationReason: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lines: z.array(
    saleLineInputV1Schema.extend({
      id,
      sku: z.string(),
      name: z.string(),
      subtotal: moneyV1Schema,
    }),
  ),
  operations: z.array(
    z.object({
      id,
      kind: z.enum(['CONFIRM', 'CANCEL']),
      status: z.enum(SALE_OPERATION_STATUSES_V1),
      error: z.string().nullable(),
      createdAt: z.string().datetime(),
      updatedAt: z.string().datetime(),
    }),
  ),
});
export const saleListV1Schema = z.object({
  data: z.array(saleV1Schema),
  pagination: paginationV1Schema,
});
export type CreateMoneyAccountV1 = z.infer<typeof createMoneyAccountV1Schema>;
export type UpdateMoneyAccountV1 = z.infer<typeof updateMoneyAccountV1Schema>;
export type AccountFiltersV1 = z.infer<typeof accountFiltersV1Schema>;
export type ManualMovementInputV1 = z.infer<typeof manualMovementInputV1Schema>;
export type FinanceMovementFiltersV1 = z.infer<
  typeof financeMovementFiltersV1Schema
>;
export type PurchasePaymentInputV1 = z.infer<
  typeof purchasePaymentInputV1Schema
>;
export type PaymentFiltersV1 = z.infer<typeof paymentFiltersV1Schema>;
export type CreateSaleV1 = z.infer<typeof createSaleV1Schema>;
export type CancelSaleV1 = z.infer<typeof cancelSaleV1Schema>;
export type SaleFiltersV1 = z.infer<typeof saleFiltersV1Schema>;
export type SaleStockRequestV1 = z.infer<typeof saleStockRequestV1Schema>;
export type SaleStockResultV1 = z.infer<typeof saleStockResultV1Schema>;
export type SaleableItemFiltersV1 = z.infer<typeof saleableItemFiltersV1Schema>;
export type PurchaseSnapshotV1 = z.infer<typeof purchaseSnapshotV1Schema>;
export type SaleV1 = z.infer<typeof saleV1Schema>;
export type MoneyAccountV1 = z.infer<typeof moneyAccountV1Schema>;
export type FinanceMovementV1 = z.infer<typeof financeMovementV1Schema>;
export type PurchasePaymentV1 = z.infer<typeof purchasePaymentV1Schema>;
export type SaleableItemV1 = z.infer<typeof saleableItemV1Schema>;
