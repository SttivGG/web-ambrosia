import { applyDecorators } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { z } from 'zod';
import { productionErrorV1Schema } from '@ambrosia/contracts';
function schema(value: z.ZodType): SchemaObject {
  const json = z.toJSONSchema(value, {
    target: 'openapi-3.0',
    io: 'input',
    unrepresentable: 'any',
  });
  return json as SchemaObject;
}
const httpError = productionErrorV1Schema.extend({
  code: z.union([
    productionErrorV1Schema.shape.code,
    z.enum([
      'AUTHENTICATION_REQUIRED',
      'ACCESS_DENIED',
      'AUTHENTICATION_UNAVAILABLE',
    ]),
  ]),
  statusCode: z.number().int().optional(),
  requestId: z.string().optional(),
  correlationId: z.string().optional(),
});
export const body = (value: z.ZodType, example?: unknown) =>
  ApiBody({
    schema: { ...schema(value), ...(example === undefined ? {} : { example }) },
  });
export function responses(value: z.ZodType, permission: string, status = 200) {
  return applyDecorators(
    ApiOperation({
      description:
        'Permiso: ' +
        permission +
        '. Cookies requieren CSRF y origen permitido. expectedVersion protege ediciones y transiciones. 409 exige comparar versiones. Las operaciones pendientes se reconcilian con el mismo UUID. Rendimiento y envasado solo se confirman tras el efecto idempotente en Inventory. Cantidades decimales como texto en unidad base.',
    }),
    ApiResponse({ status, schema: schema(value) }),
    ...[400, 401, 403, 404, 409, 500, 503].map((status) =>
      ApiResponse({
        status,
        description:
          'Validación, autenticación, permisos/CSRF, recurso ausente, conflicto o indisponibilidad.',
        schema: schema(httpError),
      }),
    ),
  );
}
export function queries(value: z.ZodType) {
  const properties = schema(value).properties ?? {};
  return applyDecorators(
    ...Object.entries(properties).map(([name, value]) =>
      ApiQuery({ name, required: false, schema: value }),
    ),
  );
}
