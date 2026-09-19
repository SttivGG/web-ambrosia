import { applyDecorators } from '@nestjs/common';
import { ApiQuery, ApiResponse } from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import {
  ITEM_TYPES_V1,
  BASE_UNITS_V1,
  OPERATION_UNITS_V1,
  CAPACITY_UNITS_V1,
  CATALOG_ERROR_CODES_V1,
} from '@ambrosia/contracts';
const str = (maxLength: number): SchemaObject => ({
  type: 'string',
  maxLength,
});
const decimal: SchemaObject = {
  type: 'string',
  nullable: true,
  pattern: '^(0|[1-9][0-9]{0,13})(\\.[0-9]{1,10})?$',
  example: '4',
  description: 'Decimal(24,10) como string; sin exponentes ni redondeo.',
};
export const versionBody: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['expectedVersion'],
  properties: {
    expectedVersion: { type: 'integer', minimum: 1, maximum: 2147483646 },
  },
};
export function categoryBody(update: boolean): SchemaObject {
  return {
    type: 'object',
    additionalProperties: false,
    required: update ? ['expectedVersion'] : ['name'],
    properties: {
      name: { ...str(80), minLength: 2 },
      description: { ...str(2000), nullable: true },
      ...(update ? versionBody.properties : {}),
    },
  };
}
export function itemBody(update: boolean): SchemaObject {
  return {
    type: 'object',
    additionalProperties: false,
    required: update
      ? ['expectedVersion']
      : [
          'sku',
          'name',
          'itemType',
          'categoryId',
          'inventoryBaseUnit',
          'defaultOperationUnit',
        ],
    properties: {
      ...(update
        ? versionBody.properties
        : {
            sku: {
              type: 'string' as const,
              pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{2,39}$',
              example: 'ENVASE-4OZ',
            },
          }),
      name: { ...str(120), minLength: 2 },
      description: { ...str(2000), nullable: true },
      itemType: { type: 'string', enum: [...ITEM_TYPES_V1] },
      categoryId: { type: 'string', format: 'uuid' },
      inventoryBaseUnit: { type: 'string', enum: [...BASE_UNITS_V1] },
      defaultOperationUnit: { type: 'string', enum: [...OPERATION_UNITS_V1] },
      nominalCapacityValue: decimal,
      nominalCapacityUnit: {
        type: 'string',
        enum: [...CAPACITY_UNITS_V1],
        nullable: true,
      },
      minimumStockBase: decimal,
      trackInventory: { type: 'boolean', default: true },
      barcode: { ...str(80), nullable: true },
    },
  };
}
export function listQueries(items: boolean) {
  return applyDecorators(
    ApiQuery({
      name: 'page',
      required: false,
      type: Number,
      minimum: 1,
      maximum: 1000000,
    }),
    ApiQuery({
      name: 'pageSize',
      required: false,
      type: Number,
      minimum: 1,
      maximum: 100,
    }),
    ApiQuery({ name: 'search', required: false, type: String, maxLength: 120 }),
    ApiQuery({ name: 'active', required: false, enum: ['true', 'false'] }),
    ApiQuery({
      name: 'sortBy',
      required: false,
      enum: items
        ? ['name', 'sku', 'itemType', 'createdAt', 'updatedAt']
        : ['name', 'createdAt', 'updatedAt'],
    }),
    ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] }),
    ...(items
      ? [
          ApiQuery({
            name: 'itemType',
            required: false,
            enum: [...ITEM_TYPES_V1],
          }),
          ApiQuery({
            name: 'categoryId',
            required: false,
            type: String,
            format: 'uuid',
          }),
          ApiQuery({
            name: 'inventoryBaseUnit',
            required: false,
            enum: [...BASE_UNITS_V1],
          }),
        ]
      : []),
  );
}
export function catalogResponses(
  kind: 'category' | 'item' | 'categoryList' | 'itemList',
  status = 200,
) {
  const properties = {
    ...(kind.startsWith('category')
      ? categoryBody(false).properties
      : itemBody(false).properties),
    id: { type: 'string', format: 'uuid' },
    version: { type: 'integer' },
    active: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    archivedAt: { type: 'string', format: 'date-time', nullable: true },
    ...(kind.startsWith('category') ? { slug: { type: 'string' } } : {}),
  } as Record<string, SchemaObject>;
  const record: SchemaObject = {
    type: 'object',
    properties,
    required: Object.keys(properties),
  };
  const schema: SchemaObject = kind.endsWith('List')
    ? {
        type: 'object',
        properties: {
          data: { type: 'array', items: record },
          pagination: {
            type: 'object',
            properties: Object.fromEntries(
              ['page', 'pageSize', 'totalItems', 'totalPages'].map((k) => [
                k,
                { type: 'integer' },
              ]),
            ),
          },
        },
      }
    : record;
  return applyDecorators(
    ApiResponse({ status, schema }),
    ...[400, 401, 403, 404, 409, 503].map((code) =>
      ApiResponse({
        status: code,
        description:
          code === 403
            ? 'Sin permiso o CSRF inválido. Cookie requiere X-CSRF-Token y Origin; Bearer exclusivo no requiere CSRF.'
            : 'Error seguro; mutaciones requieren inventory.write y expectedVersion al modificar.',
        schema: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              enum: [
                ...CATALOG_ERROR_CODES_V1,
                'AUTHENTICATION_REQUIRED',
                'ACCESS_DENIED',
                'AUTHENTICATION_UNAVAILABLE',
              ],
            },
            message: { type: 'string' },
            fields: { type: 'array', items: { type: 'string' } },
          },
        },
      }),
    ),
  );
}
