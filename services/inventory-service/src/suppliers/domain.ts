import { HttpException } from '@nestjs/common';
import {
  SUPPLIER_ERROR_CODES_V1,
  supplierIdentificationPair,
} from '@ambrosia/contracts';
import { Prisma } from '../generated/prisma/client';
export class SupplierError extends HttpException {
  constructor(
    code: (typeof SUPPLIER_ERROR_CODES_V1)[number],
    status: number,
    message: string,
    fields: string[] = [],
  ) {
    super({ code, message, fields }, status);
  }
}
export const supplierConflict = () =>
  new SupplierError(
    'CONCURRENT_MODIFICATION',
    409,
    'Otra persona modificó el registro. Compara la versión actual antes de guardar.',
  );
export function validateIdentification(value: {
  identificationType?: string | null;
  identificationNumber?: string | null;
}) {
  if (!supplierIdentificationPair(value))
    throw new SupplierError(
      'VALIDATION_ERROR',
      400,
      'Indica tipo y número juntos, o deja ambos vacíos.',
      ['identificationType', 'identificationNumber'],
    );
}
export function supplierDatabaseError(error: unknown): never {
  if (error instanceof SupplierError) throw error;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (
      ['P2034', 'P2025'].includes(error.code) ||
      (error.code === 'P2010' &&
        /40001|40P01/.test(JSON.stringify(error.meta ?? {})))
    )
      throw supplierConflict();
    if (error.code === 'P2002') {
      const target = JSON.stringify(error.meta ?? {});
      const code = /Supplier_code|\bcode\b/.test(target);
      throw new SupplierError(
        code
          ? 'SUPPLIER_CODE_ALREADY_EXISTS'
          : 'SUPPLIER_IDENTIFICATION_ALREADY_EXISTS',
        409,
        code
          ? 'El código ya está reservado, incluso si el proveedor está archivado.'
          : 'La identificación ya está reservada, incluso si el proveedor está archivado.',
        code ? ['code'] : ['identificationType', 'identificationNumber'],
      );
    }
    if (error.code === 'P2003')
      throw new SupplierError(
        'ITEM_NOT_FOUND',
        400,
        'Uno de los artículos ya no existe.',
        ['itemIds'],
      );
  }
  throw new SupplierError(
    'SUPPLIER_UNAVAILABLE',
    503,
    'No se pudo completar la operación. Consulta el estado actual antes de repetirla.',
  );
}
