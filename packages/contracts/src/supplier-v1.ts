import { z } from 'zod';
import {
  categoryFiltersV1Schema,
  paginationV1Schema,
  versionV1Schema,
} from './catalog-v1';

export const IDENTIFICATION_TYPES_V1 = [
  'NIT',
  'CC',
  'CE',
  'PASSPORT',
  'OTHER',
] as const;
export const SUPPLIER_ERROR_CODES_V1 = [
  'VALIDATION_ERROR',
  'SUPPLIER_NOT_FOUND',
  'SUPPLIER_CODE_ALREADY_EXISTS',
  'SUPPLIER_IDENTIFICATION_ALREADY_EXISTS',
  'ITEM_NOT_FOUND',
  'ITEM_ARCHIVED',
  'CONCURRENT_MODIFICATION',
  'SUPPLIER_UNAVAILABLE',
] as const;
export const supplierErrorV1Schema = z.object({
  code: z.enum(SUPPLIER_ERROR_CODES_V1),
  message: z.string(),
  fields: z.array(z.string()).optional(),
});
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable();
const fields = {
  name: z.string().trim().min(2).max(160),
  tradeName: optionalText(160).optional(),
  identificationType: z.enum(IDENTIFICATION_TYPES_V1).nullable().optional(),
  identificationNumber: z
    .string()
    .trim()
    .max(40)
    .regex(/^[A-Za-z0-9 .-]*$/)
    .transform((v) => v || null)
    .nullable()
    .optional(),
  contactName: optionalText(120).optional(),
  email: z
    .string()
    .trim()
    .max(254)
    .refine(
      (v) => v === '' || z.email().safeParse(v).success,
      'Indica un correo válido.',
    )
    .transform((v) => v || null)
    .nullable()
    .optional(),
  phone: optionalText(40).optional(),
  address: optionalText(240).optional(),
  municipality: optionalText(100).optional(),
  department: optionalText(100).optional(),
  notes: optionalText(2000).optional(),
};
export const normalizeSupplierIdentification = (value: string) =>
  value.trim().toUpperCase().replace(/[ .-]/g, '');
const itemIds = z
  .array(z.string().uuid())
  .max(500)
  .refine((ids) => new Set(ids).size === ids.length, 'No repitas artículos.');
const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{2,39}$/);
export const supplierIdentificationPair = (value: {
  identificationType?: string | null;
  identificationNumber?: string | null;
}) =>
  (value.identificationType != null) === (value.identificationNumber != null) &&
  (value.identificationNumber == null ||
    normalizeSupplierIdentification(value.identificationNumber).length > 0);
export const createSupplierV1Schema = z
  .object({ code, ...fields, itemIds: itemIds.optional() })
  .strict()
  .refine(supplierIdentificationPair, {
    message: 'Indica tipo y número juntos, o deja ambos vacíos.',
    path: ['identificationNumber'],
  });
// PATCH validates the identification pair after merging with the stored record.
export const updateSupplierV1Schema = z
  .object({ ...fields })
  .partial()
  .extend({ ...versionV1Schema.shape, itemIds: itemIds.optional() })
  .strict();
export const supplierFiltersV1Schema = categoryFiltersV1Schema
  .extend({
    sortBy: z.enum(['name', 'code', 'createdAt', 'updatedAt']).default('name'),
    itemId: z.string().uuid().optional(),
  })
  .strict();
export const supplierItemV1Schema = z
  .object({
    id: z.string().uuid(),
    sku: z.string(),
    name: z.string(),
    active: z.boolean(),
  })
  .strict();
export const supplierV1Schema = z
  .object({
    code,
    name: fields.name,
    tradeName: optionalText(160),
    identificationType: z.enum(IDENTIFICATION_TYPES_V1).nullable(),
    identificationNumber: z.string().nullable(),
    contactName: optionalText(120),
    email: z.string().nullable(),
    phone: optionalText(40),
    address: optionalText(240),
    municipality: optionalText(100),
    department: optionalText(100),
    notes: optionalText(2000),
    id: z.string().uuid(),
    active: z.boolean(),
    version: z.number().int().positive(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    archivedAt: z.string().datetime().nullable(),
    items: z.array(supplierItemV1Schema),
  })
  .strict();
export const supplierListV1Schema = z.object({
  data: z.array(supplierV1Schema),
  pagination: paginationV1Schema,
});
export type SupplierV1 = z.infer<typeof supplierV1Schema>;
export type SupplierItemV1 = z.infer<typeof supplierItemV1Schema>;
export type CreateSupplierV1 = z.infer<typeof createSupplierV1Schema>;
export type UpdateSupplierV1 = z.infer<typeof updateSupplierV1Schema>;
export type SupplierFiltersV1 = z.infer<typeof supplierFiltersV1Schema>;
