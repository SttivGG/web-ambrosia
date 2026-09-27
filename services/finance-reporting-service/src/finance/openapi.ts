import { applyDecorators } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { z } from 'zod';
import { financeErrorV1Schema } from '@ambrosia/contracts';
const schema = (value: z.ZodType) =>
  z.toJSONSchema(value, {
    target: 'openapi-3.0',
    io: 'input',
    unrepresentable: 'any',
  }) as SchemaObject;
const httpError = financeErrorV1Schema.extend({
  code: z.union([
    financeErrorV1Schema.shape.code,
    z.enum([
      'AUTHENTICATION_REQUIRED',
      'ACCESS_DENIED',
      'AUTHENTICATION_UNAVAILABLE',
    ]),
  ]),
  statusCode: z.number().int().optional(),
  requestId: z.string().optional(),
});
export const body = (value: z.ZodType) => ApiBody({ schema: schema(value) });
export const responses = (value: z.ZodType, permission: string, status = 200) =>
  applyDecorators(
    ApiOperation({
      description:
        'Permiso: ' +
        permission +
        '. Cookies requieren CSRF. Dinero COP viaja como texto Decimal. Los saldos usan solo movimientos confirmados. Ventas y anulaciones conservan UUID y se reconcilian sin transacción distribuida.',
    }),
    ApiResponse({ status, schema: schema(value) }),
    ...[400, 401, 403, 404, 409, 500, 503].map((code) =>
      ApiResponse({ status: code, schema: schema(httpError) }),
    ),
  );
export const queries = (value: z.ZodType) => {
  const properties = schema(value).properties ?? {};
  return applyDecorators(
    ...Object.entries(properties).map(([name, definition]) =>
      ApiQuery({ name, required: false, schema: definition }),
    ),
  );
};
