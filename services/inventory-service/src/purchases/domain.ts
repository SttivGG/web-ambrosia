import { HttpException } from '@nestjs/common';
import {
  type PURCHASE_ERROR_CODES_V1,
  type CreatePurchaseV1,
} from '@ambrosia/contracts';
import { Prisma } from '../generated/prisma/client';
export class PurchaseError extends HttpException {
  constructor(
    code: (typeof PURCHASE_ERROR_CODES_V1)[number],
    status: number,
    message: string,
    fields: string[] = [],
  ) {
    super({ code, message, fields }, status);
  }
}
export const conflict = () =>
  new PurchaseError(
    'CONCURRENT_MODIFICATION',
    409,
    'El registro cambió. Consulta y compara la versión actual antes de volver a guardar.',
  );
export function version(actual: number, expected: number) {
  if (actual !== expected) throw conflict();
}
export function draft(status: string) {
  if (status !== 'DRAFT')
    throw new PurchaseError(
      'INVALID_PURCHASE_STATE',
      409,
      'Solo puedes modificar o recibir un borrador.',
    );
}
export function databaseError(error: unknown): never {
  if (error instanceof PurchaseError) throw error;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (
      ['P2034', 'P2025'].includes(error.code) ||
      (error.code === 'P2010' &&
        /40001|40P01/.test(JSON.stringify(error.meta ?? {})))
    )
      throw conflict();
    if (error.code === 'P2002')
      throw new PurchaseError(
        'DUPLICATE_OPERATION',
        409,
        'La referencia o la operación ya existe. Consulta el estado antes de repetirla.',
      );
    if (error.code === 'P2003')
      throw new PurchaseError(
        'VALIDATION_ERROR',
        400,
        'Una referencia no existe.',
      );
    if (error.code === 'P2020')
      throw new PurchaseError(
        'DECIMAL_OVERFLOW',
        400,
        'El importe o saldo excede la precisión permitida.',
      );
  }
  throw new PurchaseError(
    'INTERNAL_ERROR',
    500,
    'No se pudo completar la operación. Consulta su estado antes de repetirla.',
  );
}
type Schema<T> = {
  safeParse(
    value: unknown,
  ):
    | { success: true; data: T }
    | { success: false; error: { issues: { path: PropertyKey[] }[] } };
};
export function parse<T>(schema: Schema<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success)
    throw new PurchaseError(
      'VALIDATION_ERROR',
      400,
      'Revisa los campos, formatos y límites.',
      r.error.issues.map((i) => i.path.join('.')),
    );
  return r.data;
}
const Decimal = Prisma.Decimal.clone({
  precision: 80,
  rounding: Prisma.Decimal.ROUND_HALF_UP,
});
export function amounts(lines: CreatePurchaseV1['lines']) {
  const calculated = lines.map((l) => ({
    ...l,
    subtotal: new Decimal(l.quantity)
      .mul(l.unitCost)
      .toDecimalPlaces(2)
      .toFixed(2),
  }));
  const total = calculated.reduce(
    (sum, l) => sum.plus(l.subtotal),
    new Decimal(0),
  );
  if (total.gte('10000000000000000000000'))
    throw new PurchaseError(
      'DECIMAL_OVERFLOW',
      400,
      'El total excede 22 enteros y dos decimales.',
      ['lines'],
    );
  return {
    lines: calculated,
    subtotal: total.toFixed(2),
    total: total.toFixed(2),
  };
}
export const pagination = (
  q: { page: number; pageSize: number },
  totalItems: number,
) => ({
  page: q.page,
  pageSize: q.pageSize,
  totalItems,
  totalPages: Math.ceil(totalItems / q.pageSize),
});
