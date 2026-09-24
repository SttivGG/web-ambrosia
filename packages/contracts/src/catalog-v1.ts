import { z } from 'zod';
export const ITEM_TYPES_V1 = [
  'RAW_MATERIAL',
  'PACKAGING',
  'FINISHED_PRODUCT',
  'BYPRODUCT',
  'SUPPLY',
] as const;
export const BASE_UNITS_V1 = ['UNIT', 'GRAM', 'MILLILITER'] as const;
export const OPERATION_UNITS_V1 = [
  'UNIT',
  'GRAM',
  'KILOGRAM',
  'MILLILITER',
  'LITER',
] as const;
export const CAPACITY_UNITS_V1 = ['MILLILITER', 'FLUID_OUNCE', 'GRAM'] as const;
export const CATALOG_ERROR_CODES_V1 = [
  'INVENTORY_HISTORY_EXISTS',
  'CATEGORY_NOT_FOUND',
  'CATEGORY_NAME_ALREADY_EXISTS',
  'CATEGORY_HAS_ACTIVE_ITEMS',
  'CATEGORY_ARCHIVED',
  'ITEM_NOT_FOUND',
  'ITEM_SKU_ALREADY_EXISTS',
  'ITEM_BARCODE_ALREADY_EXISTS',
  'INVALID_UNIT_COMBINATION',
  'INVALID_NOMINAL_CAPACITY',
  'CONCURRENT_MODIFICATION',
  'ITEM_ALREADY_ARCHIVED',
  'ITEM_ALREADY_ACTIVE',
  'VALIDATION_ERROR',
] as const;
export type CatalogErrorCodeV1 = (typeof CATALOG_ERROR_CODES_V1)[number];
export const catalogErrorV1Schema = z.object({
  code: z.enum(CATALOG_ERROR_CODES_V1),
  message: z.string(),
  fields: z.array(z.string()).optional(),
});
// NUMERIC(24,10): strings only, with no rounding of quantities.
export const decimalV1Schema = z
  .string()
  .regex(
    /^(0|[1-9]\d{0,13})(\.\d{1,10})?$/,
    'Utiliza hasta 14 enteros y 10 decimales, sin signo ni exponentes.',
  );
const description = z.string().trim().max(2000).nullable();
export const createCategoryV1Schema = z
  .object({
    name: z.string().trim().min(2).max(80),
    description: description.optional(),
  })
  .strict();
export const versionV1Schema = z
  .object({ expectedVersion: z.number().int().min(1).max(2147483646) })
  .strict();
export const updateCategoryV1Schema = createCategoryV1Schema
  .partial()
  .extend(versionV1Schema.shape)
  .strict();
export const createItemV1Schema = z
  .object({
    sku: z
      .string()
      .transform((v) => v.toUpperCase())
      .pipe(z.string().regex(/^[A-Z0-9][A-Z0-9_-]{2,39}$/)),
    name: z.string().trim().min(2).max(120),
    description: description.optional(),
    itemType: z.enum(ITEM_TYPES_V1),
    categoryId: z.string().uuid(),
    inventoryBaseUnit: z.enum(BASE_UNITS_V1),
    defaultOperationUnit: z.enum(OPERATION_UNITS_V1),
    nominalCapacityValue: decimalV1Schema.nullable().optional(),
    nominalCapacityUnit: z.enum(CAPACITY_UNITS_V1).nullable().optional(),
    trackInventory: z.boolean().default(true),
    minimumStockBase: decimalV1Schema.nullable().optional(),
    barcode: z.string().trim().min(1).max(80).nullable().optional(),
  })
  .strict();
export const updateItemV1Schema = createItemV1Schema
  .omit({ sku: true })
  .partial()
  .extend({ ...versionV1Schema.shape, trackInventory: z.boolean().optional() })
  .strict();
const queryInteger = (fallback: number, max: number) =>
  z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .pipe(z.number().int().max(max))
    .default(fallback);
const queryFields = {
  page: queryInteger(1, 1000000),
  pageSize: queryInteger(20, 100),
  search: z.string().trim().max(120).optional(),
  active: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
};
export const categoryFiltersV1Schema = z
  .object({
    ...queryFields,
    sortBy: z.enum(['name', 'createdAt', 'updatedAt']).default('name'),
  })
  .strict();
export const itemFiltersV1Schema = z
  .object({
    ...queryFields,
    sortBy: z
      .enum(['name', 'sku', 'createdAt', 'updatedAt', 'itemType'])
      .default('name'),
    itemType: z.enum(ITEM_TYPES_V1).optional(),
    categoryId: z.string().uuid().optional(),
    inventoryBaseUnit: z.enum(BASE_UNITS_V1).optional(),
  })
  .strict();
const recordFields = {
  id: z.string().uuid(),
  active: z.boolean(),
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  archivedAt: z.string().datetime().nullable(),
};
export const categoryV1Schema = createCategoryV1Schema.extend({
  ...recordFields,
  description,
  slug: z.string(),
});
export const catalogItemV1Schema = createItemV1Schema.extend({
  ...recordFields,
  description,
  nominalCapacityValue: decimalV1Schema.nullable(),
  nominalCapacityUnit: z.enum(CAPACITY_UNITS_V1).nullable(),
  minimumStockBase: decimalV1Schema.nullable(),
  barcode: z.string().nullable(),
});
export const paginationV1Schema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive().max(100),
  totalItems: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});
export const categoryListV1Schema = z.object({
  data: z.array(categoryV1Schema),
  pagination: paginationV1Schema,
});
export const itemListV1Schema = z.object({
  data: z.array(catalogItemV1Schema),
  pagination: paginationV1Schema,
});
export type CategoryV1 = z.infer<typeof categoryV1Schema>;
export type CatalogItemV1 = z.infer<typeof catalogItemV1Schema>;
export type CreateCategoryV1 = z.infer<typeof createCategoryV1Schema>;
export type UpdateCategoryV1 = z.infer<typeof updateCategoryV1Schema>;
export type CreateItemV1 = z.infer<typeof createItemV1Schema>;
export type UpdateItemV1 = z.infer<typeof updateItemV1Schema>;
export type CatalogVersionV1 = z.infer<typeof versionV1Schema>;
export type CategoryFiltersV1 = z.infer<typeof categoryFiltersV1Schema>;
export type ItemFiltersV1 = z.infer<typeof itemFiltersV1Schema>;

export const archiveCategoryV1Schema = versionV1Schema;
export const restoreCategoryV1Schema = versionV1Schema;
export const archiveItemV1Schema = versionV1Schema;
export const restoreItemV1Schema = versionV1Schema;
export type ArchiveCategoryV1 = CatalogVersionV1;
export type RestoreCategoryV1 = CatalogVersionV1;
export type ArchiveItemV1 = CatalogVersionV1;
export type RestoreItemV1 = CatalogVersionV1;
