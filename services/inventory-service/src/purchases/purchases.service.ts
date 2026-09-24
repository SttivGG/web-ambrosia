import { Inject, Injectable } from '@nestjs/common';
import {
  createPurchaseV1Schema,
  updatePurchaseV1Schema,
  purchaseV1Schema,
  type CreatePurchaseV1,
  type UpdatePurchaseV1,
  type PurchaseFiltersV1,
} from '@ambrosia/contracts';
import { PrismaService } from '../prisma.service';
import { Prisma } from '../generated/prisma/client';
import { StockService } from './stock.service';
import {
  PurchaseError,
  amounts,
  conflict,
  databaseError,
  draft,
  parse,
  pagination,
  version,
} from './domain';
const include = {
  supplier: true,
  lines: { include: { item: true }, orderBy: { itemId: 'asc' as const } },
};
type Row = Prisma.PurchaseGetPayload<{ include: typeof include }>;
export const purchaseDTO = (r: Row) =>
  purchaseV1Schema.parse({
    ...r,
    subtotal: r.subtotal.toFixed(2),
    total: r.total.toFixed(2),
    purchasedAt: r.purchasedAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    receivedAt: r.receivedAt?.toISOString() ?? null,
    cancelledAt: r.cancelledAt?.toISOString() ?? null,
    lines: r.lines.map((l) => ({
      id: l.id,
      itemId: l.itemId,
      item: l.item,
      baseUnit: l.baseUnit,
      quantity: l.quantity.toFixed(),
      unitCost: l.unitCost.toFixed(2),
      subtotal: l.subtotal.toFixed(2),
    })),
  });
@Injectable()
export class PurchasesService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(StockService) private readonly stock: StockService,
  ) {}
  private async transaction<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    try {
      return await this.db.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 10000,
      });
    } catch (e) {
      databaseError(e);
    }
  }
  private async row(tx: Prisma.TransactionClient, id: string) {
    const r = await tx.purchase.findUnique({ where: { id }, include });
    if (!r)
      throw new PurchaseError(
        'PURCHASE_NOT_FOUND',
        404,
        'La compra no existe.',
      );
    return r;
  }
  async get(id: string) {
    try {
      return purchaseDTO(await this.row(this.db, id));
    } catch (e) {
      databaseError(e);
    }
  }
  async list(q: PurchaseFiltersV1) {
    const where: Prisma.PurchaseWhereInput = {
      supplierId: q.supplierId,
      status: q.status,
      reference: q.reference
        ? { contains: q.reference, mode: 'insensitive' }
        : undefined,
      purchasedAt: { gte: q.from, lte: q.to },
    };
    try {
      const [rows, count] = await this.db.$transaction(
        [
          this.db.purchase.findMany({
            where,
            include,
            skip: (q.page - 1) * q.pageSize,
            take: q.pageSize,
            orderBy: [{ purchasedAt: 'desc' }, { id: 'asc' }],
          }),
          this.db.purchase.count({ where }),
        ],
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
      return { data: rows.map(purchaseDTO), pagination: pagination(q, count) };
    } catch (e) {
      databaseError(e);
    }
  }
  private async validated(
    tx: Prisma.TransactionClient,
    data: CreatePurchaseV1,
  ) {
    const supplier = await tx.supplier.findUnique({
      where: { id: data.supplierId },
      include: { items: true },
    });
    if (!supplier)
      throw new PurchaseError(
        'SUPPLIER_NOT_FOUND',
        404,
        'El proveedor no existe.',
        ['supplierId'],
      );
    if (!supplier.active)
      throw new PurchaseError(
        'INACTIVE_RESOURCE',
        409,
        'El proveedor está archivado.',
        ['supplierId'],
      );
    const items = await this.stock.lockItems(
      tx,
      data.lines.map((l) => l.itemId),
    );
    for (const l of data.lines) {
      const item = items.find((i) => i.id === l.itemId)!;
      this.stock.requireTracked(item);
      if (!supplier.items.some((i) => i.itemId === l.itemId))
        throw new PurchaseError(
          'ITEM_NOT_ASSOCIATED',
          409,
          'Asocia primero el artículo al proveedor.',
          ['lines'],
        );
    }
    const totals = amounts(data.lines);
    return {
      ...totals,
      lines: totals.lines.map((l) => ({
        ...l,
        baseUnit: items.find((i) => i.id === l.itemId)!.inventoryBaseUnit,
      })),
    };
  }
  create(input: CreatePurchaseV1) {
    const data = parse(createPurchaseV1Schema, input);
    return this.transaction(async (tx) => {
      const { lines, subtotal, total } = await this.validated(tx, data);
      return purchaseDTO(
        await tx.purchase.create({
          data: {
            ...data,
            purchasedAt: new Date(data.purchasedAt),
            subtotal,
            total,
            lines: { create: lines },
          },
          include,
        }),
      );
    });
  }
  update(id: string, input: UpdatePurchaseV1) {
    const { expectedVersion, ...data } = parse(updatePurchaseV1Schema, input);
    return this.transaction(async (tx) => {
      const row = await this.row(tx, id);
      version(row.version, expectedVersion);
      draft(row.status);
      const { lines, subtotal, total } = await this.validated(tx, data);
      const r = await tx.purchase.updateMany({
        where: { id, version: expectedVersion, status: 'DRAFT' },
        data: {
          supplierId: data.supplierId,
          reference: data.reference,
          purchasedAt: new Date(data.purchasedAt),
          notes: data.notes ?? null,
          subtotal,
          total,
          version: { increment: 1 },
        },
      });
      if (r.count !== 1) throw conflict();
      await tx.purchaseLine.deleteMany({ where: { purchaseId: id } });
      await tx.purchaseLine.createMany({
        data: lines.map((l) => ({ ...l, purchaseId: id })),
      });
      return purchaseDTO(await this.row(tx, id));
    });
  }
  receive(id: string, expectedVersion: number, actorId: string) {
    return this.transaction(async (tx) => {
      const row = await this.row(tx, id);
      version(row.version, expectedVersion);
      draft(row.status);
      await this.validated(tx, {
        supplierId: row.supplierId,
        reference: row.reference,
        purchasedAt: row.purchasedAt.toISOString(),
        lines: row.lines.map((l) => ({
          itemId: l.itemId,
          quantity: l.quantity.toFixed(),
          unitCost: l.unitCost.toFixed(2),
        })),
      });
      if (row.lines.some((l) => l.baseUnit !== l.item.inventoryBaseUnit))
        throw new PurchaseError(
          'VALIDATION_ERROR',
          409,
          'La unidad del artículo cambió. Edita el borrador antes de recibir.',
        );
      const result = await tx.purchase.updateMany({
        where: { id, version: expectedVersion, status: 'DRAFT' },
        data: {
          status: 'RECEIVED',
          receivedAt: new Date(),
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) throw conflict();
      for (const l of row.lines)
        await this.stock.record(tx, {
          itemId: l.itemId,
          baseUnit: l.baseUnit,
          type: 'PURCHASE_IN',
          quantity: l.quantity.toFixed(),
          origin: 'PURCHASE',
          reference: row.reference,
          reason: 'Recepción de compra',
          actorId,
          purchaseLineId: l.id,
        });
      return purchaseDTO(await this.row(tx, id));
    });
  }
  cancel(id: string, expectedVersion: number, reason: string, actorId: string) {
    return this.transaction(async (tx) => {
      const row = await this.row(tx, id);
      version(row.version, expectedVersion);
      if (row.status === 'CANCELLED')
        throw new PurchaseError(
          'INVALID_PURCHASE_STATE',
          409,
          'La compra ya está cancelada.',
        );
      if (row.status === 'RECEIVED') {
        await this.stock.lockItems(
          tx,
          row.lines.map((l) => l.itemId),
        );
        for (const l of row.lines) {
          const original = await tx.inventoryMovement.findUnique({
            where: {
              purchaseLineId_type: {
                purchaseLineId: l.id,
                type: 'PURCHASE_IN',
              },
            },
          });
          if (!original)
            throw new PurchaseError(
              'INTERNAL_ERROR',
              500,
              'No se encontró la entrada original.',
            );
          await this.stock.record(tx, {
            itemId: l.itemId,
            baseUnit: l.baseUnit,
            type: 'REVERSAL',
            quantity: l.quantity.toFixed(),
            origin: 'PURCHASE',
            reference: row.reference,
            reason,
            actorId,
            purchaseLineId: l.id,
            reversesId: original.id,
          });
        }
      }
      const result = await tx.purchase.updateMany({
        where: { id, version: expectedVersion },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancellationReason: reason,
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) throw conflict();
      return purchaseDTO(await this.row(tx, id));
    });
  }
}
