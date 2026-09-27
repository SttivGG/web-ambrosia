import { HttpException } from '@nestjs/common';
import type { FINANCE_ERROR_CODES_V1, CreateSaleV1 } from '@ambrosia/contracts';
import { Prisma } from '../generated/prisma/client';

export class FinanceError extends HttpException {
  constructor(
    code: (typeof FINANCE_ERROR_CODES_V1)[number],
    status: number,
    message: string,
    fields: string[] = [],
  ) {
    super({ code, message, fields }, status);
  }
}
type Schema<T> = {
  safeParse(
    value: unknown,
  ):
    | { success: true; data: T }
    | { success: false; error: { issues: { path: PropertyKey[] }[] } };
};
export function parse<T>(schema: Schema<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new FinanceError(
      'VALIDATION_ERROR',
      400,
      'Revisa los campos, formatos y límites.',
      result.error.issues.map((issue) => issue.path.join('.')),
    );
  return result.data;
}
export const conflict = () =>
  new FinanceError(
    'CONCURRENT_MODIFICATION',
    409,
    'El registro cambió. Consulta la versión actual; tus datos siguen disponibles.',
  );
export function databaseError(error: unknown): never {
  if (error instanceof FinanceError) throw error;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (
      ['P2034', 'P2025'].includes(error.code) ||
      (error.code === 'P2010' &&
        /40001|40P01/.test(JSON.stringify(error.meta ?? {})))
    )
      throw conflict();
    if (error.code === 'P2002')
      throw new FinanceError(
        'DUPLICATE_OPERATION',
        409,
        'La cuenta o la operación ya existe. Consulta el estado antes de repetirla.',
      );
    if (error.code === 'P2020')
      throw new FinanceError(
        'DECIMAL_OVERFLOW',
        400,
        'El importe excede la precisión permitida.',
      );
  }
  throw new FinanceError(
    'INTERNAL_ERROR',
    500,
    'No se pudo completar la operación. Consulta su estado antes de repetirla.',
  );
}
const Exact = Prisma.Decimal.clone({
  precision: 80,
  rounding: Prisma.Decimal.ROUND_HALF_UP,
});
export function saleAmounts(lines: CreateSaleV1['lines']) {
  const calculated = lines.map((line) => ({
    ...line,
    quantityNumber: Number(line.quantity),
    subtotal: new Exact(line.quantity)
      .mul(line.unitPrice)
      .toDecimalPlaces(2)
      .toFixed(2),
  }));
  const total = calculated.reduce(
    (sum, line) => sum.plus(line.subtotal),
    new Exact(0),
  );
  if (total.lte(0) || total.gte('10000000000000000000000'))
    throw new FinanceError(
      'DECIMAL_OVERFLOW',
      400,
      'El total de la venta excede la precisión permitida.',
      ['lines'],
    );
  return {
    lines: calculated,
    subtotal: total.toFixed(2),
    total: total.toFixed(2),
  };
}
export const pagination = (
  query: { page: number; pageSize: number },
  totalItems: number,
) => ({
  page: query.page,
  pageSize: query.pageSize,
  totalItems,
  totalPages: Math.ceil(totalItems / query.pageSize),
});
