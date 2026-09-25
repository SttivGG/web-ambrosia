import { z } from 'zod';
import {
  BASE_UNITS_V1,
  categoryFiltersV1Schema,
  paginationV1Schema,
  versionV1Schema,
} from './catalog-v1';
import { quantityV1Schema, movementV1Schema } from './purchase-v1';
export const productionIdV1Schema = z.string().uuid().toLowerCase();
export const PRODUCTION_STATUSES_V1 = [
  'DRAFT',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
] as const;
export const ingredientV1Schema = z
  .object({
    itemId: productionIdV1Schema,
    quantity: quantityV1Schema,
    baseUnit: z.enum(BASE_UNITS_V1),
  })
  .strict();
export const ingredientsV1Schema = z
  .array(ingredientV1Schema)
  .min(1)
  .max(50)
  .refine(
    (v) => new Set(v.map((l) => l.itemId)).size === v.length,
    'No repitas insumos.',
  );
export const formulaInputV1Schema = z
  .object({
    name: z.string().trim().min(1).max(120),
    productId: productionIdV1Schema,
    baseUnit: z.enum(BASE_UNITS_V1),
    ingredients: ingredientsV1Schema,
    active: z.boolean(),
  })
  .strict();
export const formulaUpdateV1Schema = formulaInputV1Schema
  .extend(versionV1Schema.shape)
  .strict();
export const formulaV1Schema = formulaInputV1Schema.extend({
  id: productionIdV1Schema,
  revisionId: productionIdV1Schema,
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export const productionInputV1Schema = z
  .object({
    batch: z.string().trim().toUpperCase().min(1).max(80),
    formulaId: productionIdV1Schema,
    quantity: quantityV1Schema,
    scheduledAt: z.string().datetime(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();
export const productionUpdateV1Schema = productionInputV1Schema
  .extend(versionV1Schema.shape)
  .strict();
export const productionCancelV1Schema = versionV1Schema
  .extend({ reason: z.string().trim().min(3).max(500) })
  .strict();
export const productionFiltersV1Schema = categoryFiltersV1Schema
  .pick({ page: true, pageSize: true })
  .extend({
    search: z.string().trim().max(120).optional(),
    status: z.enum(PRODUCTION_STATUSES_V1).optional(),
  })
  .strict();
export const formulaFiltersV1Schema = categoryFiltersV1Schema
  .pick({ page: true, pageSize: true })
  .extend({
    search: z.string().trim().max(120).optional(),
    active: z.enum(['true', 'false']).optional(),
  })
  .strict();
export const consumptionRequestV1Schema = z
  .object({
    operationId: productionIdV1Schema,
    productionId: productionIdV1Schema,
    actorId: productionIdV1Schema,
    kind: z.enum(['CONSUME', 'REVERSE']),
    originalOperationId: productionIdV1Schema.nullable(),
    reason: z.string().trim().min(3).max(500),
    lines: ingredientsV1Schema,
  })
  .strict()
  .refine((v) =>
    v.kind === 'REVERSE'
      ? v.originalOperationId !== null
      : v.originalOperationId === null,
  );
export const consumptionResultV1Schema = z.object({
  operationId: productionIdV1Schema,
  productionId: productionIdV1Schema,
  status: z.enum(['CONFIRMED', 'REJECTED']),
  error: z.string().nullable(),
  movements: z.array(movementV1Schema),
});
export const productionOperationV1Schema = z.object({
  id: productionIdV1Schema,
  kind: z.enum(['CONSUME', 'REVERSE']),
  status: z.enum(['PENDING', 'CONFIRMED', 'REJECTED']),
  error: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  result: consumptionResultV1Schema.nullable(),
});
export const productionV1Schema = z.object({
  id: productionIdV1Schema,
  batch: z.string(),
  formulaId: productionIdV1Schema,
  formula: formulaV1Schema,
  quantity: quantityV1Schema,
  scheduledAt: z.string().datetime(),
  notes: z.string().nullable(),
  status: z.enum(PRODUCTION_STATUSES_V1),
  version: z.number().int().positive(),
  actorId: productionIdV1Schema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  cancelledAt: z.string().datetime().nullable(),
  cancellationReason: z.string().nullable(),
  ingredients: ingredientsV1Schema,
  operations: z.array(productionOperationV1Schema),
});
export const productionListV1Schema = z.object({
  data: z.array(productionV1Schema),
  pagination: paginationV1Schema,
});
export const formulaListV1Schema = z.object({
  data: z.array(formulaV1Schema),
  pagination: paginationV1Schema,
});
export const productionErrorV1Schema = z.object({
  code: z.string(),
  message: z.string(),
  fields: z.array(z.string()).optional(),
});
export type FormulaInputV1 = z.infer<typeof formulaInputV1Schema>;
export type FormulaV1 = z.infer<typeof formulaV1Schema>;
export type ProductionInputV1 = z.infer<typeof productionInputV1Schema>;
export type ProductionV1 = z.infer<typeof productionV1Schema>;
export type ConsumptionRequestV1 = z.infer<typeof consumptionRequestV1Schema>;
export type ConsumptionResultV1 = z.infer<typeof consumptionResultV1Schema>;
export type ProductionFiltersV1 = z.infer<typeof productionFiltersV1Schema>;
export type FormulaFiltersV1 = z.infer<typeof formulaFiltersV1Schema>;
