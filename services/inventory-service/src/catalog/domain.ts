import { HttpException } from '@nestjs/common';
import type { CatalogErrorCodeV1, CreateItemV1 } from '@ambrosia/contracts';
import { Prisma } from '../generated/prisma/client';
export class CatalogError extends HttpException {
  constructor(
    public readonly code: CatalogErrorCodeV1,
    status: number,
    message: string,
    public readonly fields: string[] = [],
  ) {
    super({ code, message, fields }, status);
  }
}
export const normalizeName = (name: string) =>
  name.trim().normalize('NFKC').toLowerCase();
export const categorySlug = (name: string, id: string) =>
  (normalizeName(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'categoria') +
  '-' +
  id;
export function conflict() {
  return new CatalogError(
    'CONCURRENT_MODIFICATION',
    409,
    'Otra persona modificó este registro. Consulta la versión actual antes de guardar.',
  );
}
export function requireVersion(actual: number, expected: number) {
  if (actual !== expected) throw conflict();
}
export function validateItem(
  item: Pick<
    CreateItemV1,
    | 'itemType'
    | 'inventoryBaseUnit'
    | 'defaultOperationUnit'
    | 'nominalCapacityValue'
    | 'nominalCapacityUnit'
  >,
) {
  const bases = {
    UNIT: 'UNIT',
    GRAM: 'GRAM',
    KILOGRAM: 'GRAM',
    MILLILITER: 'MILLILITER',
    LITER: 'MILLILITER',
  };
  if (
    bases[item.defaultOperationUnit] !== item.inventoryBaseUnit ||
    (item.itemType === 'PACKAGING' && item.inventoryBaseUnit !== 'UNIT') ||
    (item.itemType === 'BYPRODUCT' && item.inventoryBaseUnit === 'UNIT')
  )
    throw new CatalogError(
      'INVALID_UNIT_COMBINATION',
      400,
      'Las unidades no corresponden al tipo y dimensión del artículo.',
      ['inventoryBaseUnit', 'defaultOperationUnit'],
    );
  const value = item.nominalCapacityValue,
    unit = item.nominalCapacityUnit;
  if (
    (value != null) !== (unit != null) ||
    (value != null && !new Prisma.Decimal(value).gt(0))
  )
    throw new CatalogError(
      'INVALID_NOMINAL_CAPACITY',
      400,
      'Indica una capacidad mayor que cero y su unidad, o deja ambos campos vacíos.',
      ['nominalCapacityValue', 'nominalCapacityUnit'],
    );
}
export function translatePrisma(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2034' || error.code === 'P2025') throw conflict();
    if (error.code === 'P2002') {
      const adapter = error.meta?.driverAdapterError as
        | { cause?: { constraint?: { index?: string; fields?: string[] } } }
        | undefined;
      const constraint = adapter?.cause?.constraint;
      const target = String(
        error.meta?.target ?? constraint?.index ?? constraint?.fields ?? '',
      );
      if (target.includes('barcode'))
        throw new CatalogError(
          'ITEM_BARCODE_ALREADY_EXISTS',
          409,
          'El código de barras ya está registrado.',
          ['barcode'],
        );
      if (/sku/i.test(target))
        throw new CatalogError(
          'ITEM_SKU_ALREADY_EXISTS',
          409,
          'El SKU ya está registrado, incluso si está archivado.',
          ['sku'],
        );
      if (!/normalizedName|slug/i.test(target)) throw error;
      throw new CatalogError(
        'CATEGORY_NAME_ALREADY_EXISTS',
        409,
        'Ya existe una categoría con ese nombre.',
        ['name'],
      );
    }
    if (error.code === 'P2003')
      throw new CatalogError(
        'CATEGORY_NOT_FOUND',
        404,
        'La categoría no existe.',
        ['categoryId'],
      );
  }
  throw error;
}
