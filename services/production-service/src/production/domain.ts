import { HttpException } from '@nestjs/common';
import { ingredientsV1Schema, type FormulaInputV1 } from '@ambrosia/contracts';
import { Prisma } from '../generated/prisma/client';
export class ProductionError extends HttpException {
  constructor(
    code: string,
    status: number,
    message: string,
    fields: string[] = [],
  ) {
    super({ code, message, fields }, status);
  }
}
export const conflict = () =>
  new ProductionError(
    'CONCURRENT_MODIFICATION',
    409,
    'El registro cambió. Compara la versión actual; tus datos no se han guardado.',
  );
export function parse<T>(
  schema: {
    safeParse(
      v: unknown,
    ):
      | { success: true; data: T }
      | { success: false; error: { issues: { path: PropertyKey[] }[] } };
  },
  v: unknown,
): T {
  const result = schema.safeParse(v);
  if (!result.success)
    throw new ProductionError(
      'VALIDATION_ERROR',
      400,
      'Revisa los campos, unidades y cantidades.',
      result.error.issues.map((i) => i.path.join('.')),
    );
  return result.data;
}
export function calculate(
  ingredients: FormulaInputV1['ingredients'],
  quantity: string,
) {
  const Exact = Prisma.Decimal.clone({ precision: 80 });
  return parse(
    ingredientsV1Schema,
    ingredients.map((l) => ({
      ...l,
      quantity: new Exact(l.quantity).mul(quantity).toFixed(),
    })),
  );
}
const Exact = Prisma.Decimal.clone({
  precision: 80,
  rounding: Prisma.Decimal.ROUND_HALF_UP,
});
export function yieldMetrics(
  plannedQuantity: string,
  actualQuantity: string,
  wasteQuantity: string,
) {
  const planned = new Exact(plannedQuantity);
  const actual = new Exact(actualQuantity);
  const waste = new Exact(wasteQuantity);
  return {
    plannedQuantity: planned.toFixed(),
    actualQuantity: actual.toFixed(),
    differenceQuantity: actual.minus(planned).toFixed(),
    yieldPercentage: actual.div(planned).mul(100).toDecimalPlaces(10).toFixed(),
    wasteQuantity: waste.toFixed(),
    wastePercentage: waste.div(planned).mul(100).toDecimalPlaces(10).toFixed(),
  };
}
export function packagedProductQuantity(units: string, perUnit: string) {
  const unitQuantity = new Exact(units);
  if (!unitQuantity.isInteger())
    throw new ProductionError(
      'VALIDATION_ERROR',
      400,
      'Las unidades envasadas deben ser un entero.',
      ['unitsPackaged'],
    );
  return unitQuantity.mul(perUnit).toFixed();
}
export function databaseError(e: unknown): never {
  if (e instanceof ProductionError) throw e;
  if (
    e instanceof Prisma.PrismaClientKnownRequestError &&
    ['P2034', 'P2025', 'P2002'].includes(e.code)
  )
    throw conflict();
  throw new ProductionError(
    'PRODUCTION_UNAVAILABLE',
    503,
    'No se pudo completar la operación. Consulta el estado o reintenta la reconciliación.',
  );
}
export const pagination = (
  q: { page: number; pageSize: number },
  totalItems: number,
) => ({ ...q, totalItems, totalPages: Math.ceil(totalItems / q.pageSize) });
