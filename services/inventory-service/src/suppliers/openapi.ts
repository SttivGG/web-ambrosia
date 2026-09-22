import { applyDecorators } from '@nestjs/common';
import { ApiQuery, ApiResponse } from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import {
  IDENTIFICATION_TYPES_V1,
  SUPPLIER_ERROR_CODES_V1,
} from '@ambrosia/contracts';
import { versionBody } from '../catalog/openapi';
const optional = (maxLength: number): SchemaObject => ({
  type: 'string',
  maxLength,
  nullable: true,
  description: 'Vacío se convierte en null; omitir en PATCH conserva el valor.',
});
const fields: Record<string, SchemaObject> = {
  name: { type: 'string', minLength: 2, maxLength: 160 },
  tradeName: optional(160),
  identificationType: {
    type: 'string',
    enum: [...IDENTIFICATION_TYPES_V1],
    nullable: true,
  },
  identificationNumber: {
    ...optional(40),
    pattern: '^[A-Za-z0-9 .-]*$',
    description:
      'Tipo y número juntos o ambos null. Conserva dígitos; compara sin puntos, espacios ni guiones y en mayúsculas. No verifica identidad oficialmente.',
  },
  contactName: optional(120),
  email: { ...optional(254), format: 'email' },
  phone: optional(40),
  address: optional(240),
  municipality: optional(100),
  department: optional(100),
  notes: optional(2000),
};
const code: SchemaObject = {
  type: 'string',
  pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{2,39}$',
  description: 'Trim, mayúsculas, único incluso archivado; inmutable.',
};
export function supplierBody(update: boolean): SchemaObject {
  return {
    type: 'object',
    additionalProperties: false,
    required: update ? ['expectedVersion'] : ['code', 'name'],
    properties: {
      ...fields,
      ...(update ? versionBody.properties : { code }),
      itemIds: {
        type: 'array',
        maxItems: 500,
        uniqueItems: true,
        items: { type: 'string', format: 'uuid' },
        description:
          'Reemplazo atómico de asociaciones. Omitir conserva; [] desasocia. Nuevas asociaciones solo con artículos activos.',
      },
    },
  };
}
const record: SchemaObject = {
  type: 'object',
  required: [
    'id',
    'code',
    ...Object.keys(fields),
    'active',
    'version',
    'createdAt',
    'updatedAt',
    'archivedAt',
    'items',
  ],
  properties: {
    ...fields,
    code,
    id: { type: 'string', format: 'uuid' },
    active: { type: 'boolean' },
    version: { type: 'integer' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    archivedAt: { type: 'string', format: 'date-time', nullable: true },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          sku: { type: 'string' },
          name: { type: 'string' },
          active: { type: 'boolean' },
        },
      },
    },
  },
};
export function supplierResponses(list = false, status = 200) {
  const pagination: SchemaObject = {
    type: 'object',
    properties: Object.fromEntries(
      ['page', 'pageSize', 'totalItems', 'totalPages'].map((key) => [
        key,
        { type: 'integer' },
      ]),
    ),
  };
  return applyDecorators(
    ApiResponse({
      status,
      schema: list
        ? {
            type: 'object',
            properties: { data: { type: 'array', items: record }, pagination },
          }
        : record,
    }),
    ...[400, 401, 403, 404, 409, 503].map((status) =>
      ApiResponse({
        status,
        description:
          'Validación, autenticación, permisos/CSRF, ausencia, unicidad/concurrencia o indisponibilidad. Sin reintentos automáticos.',
        schema: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              enum: [
                ...SUPPLIER_ERROR_CODES_V1,
                'AUTHENTICATION_REQUIRED',
                'ACCESS_DENIED',
                'AUTHENTICATION_UNAVAILABLE',
              ],
            },
            message: { type: 'string' },
            fields: { type: 'array', items: { type: 'string' } },
            requestId: { type: 'string' },
            correlationId: { type: 'string' },
          },
        },
      }),
    ),
  );
}
export function supplierQueries() {
  return applyDecorators(
    ...Object.entries({
      search: {
        type: 'string',
        maxLength: 120,
        description:
          'Código, razón social, nombre comercial e identificación normalizada.',
      },
      active: { type: 'string', enum: ['true', 'false'] },
      itemId: { type: 'string', format: 'uuid' },
      page: { type: 'integer', minimum: 1, maximum: 1000000, default: 1 },
      pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      sortBy: {
        type: 'string',
        enum: ['name', 'code', 'createdAt', 'updatedAt'],
        default: 'name',
      },
      sortOrder: {
        type: 'string',
        enum: ['asc', 'desc'],
        default: 'asc',
        description: 'Desempate estable por UUID ascendente.',
      },
    }).map(([name, schema]) =>
      ApiQuery({ name, required: false, schema: schema as SchemaObject }),
    ),
  );
}
