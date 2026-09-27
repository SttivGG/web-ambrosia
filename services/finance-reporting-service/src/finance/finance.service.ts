import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  financeMovementV1Schema,
  moneyAccountV1Schema,
  purchasePaymentV1Schema,
  purchaseSnapshotV1Schema,
  saleStockRequestV1Schema,
  saleV1Schema,
  type AccountFiltersV1,
  type CancelSaleV1,
  type CreateMoneyAccountV1,
  type CreateSaleV1,
  type ManualMovementInputV1,
  type FinanceMovementFiltersV1,
  type PaymentFiltersV1,
  type PurchasePaymentInputV1,
  type SaleFiltersV1,
  type SaleStockRequestV1,
  type UpdateMoneyAccountV1,
} from '@ambrosia/contracts';
import { PrismaService } from '../prisma.service';
import { Prisma, type SaleOperation } from '../generated/prisma/client';
import { InventoryClient } from './inventory.client';
import {
  FinanceError,
  conflict,
  databaseError,
  pagination,
  saleAmounts,
} from './domain';
const movementInclude = { account: true, purchasePayment: true };
type MovementRow = Prisma.FinanceMovementGetPayload<{
  include: typeof movementInclude;
}>;
const paymentInclude = { movement: true };
type PaymentRow = Prisma.PurchasePaymentGetPayload<{
  include: typeof paymentInclude;
}>;
const saleInclude = {
  account: true,
  lines: { orderBy: [{ name: 'asc' as const }, { id: 'asc' as const }] },
  operations: {
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
  },
};
type SaleRow = Prisma.SaleGetPayload<{ include: typeof saleInclude }>;
const movementDTO = (row: MovementRow) =>
  financeMovementV1Schema.parse({
    ...row,
    amount: row.amount.toFixed(2),
    status: 'CONFIRMED',
    occurredAt: row.occurredAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    purchasePaymentId: row.purchasePayment?.id ?? null,
  });
const paymentDTO = (row: PaymentRow) =>
  purchasePaymentV1Schema.parse({
    ...row,
    amount: row.amount.toFixed(2),
    occurredAt: row.occurredAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    checkedAt: row.checkedAt?.toISOString() ?? null,
    regularizedAt: row.regularizedAt?.toISOString() ?? null,
    purchaseSnapshot: purchaseSnapshotV1Schema.parse(row.purchaseSnapshot),
  });
const saleDTO = (row: SaleRow) =>
  saleV1Schema.parse({
    ...row,
    subtotal: row.subtotal.toFixed(2),
    total: row.total.toFixed(2),
    occurredAt: row.occurredAt.toISOString(),
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lines: row.lines.map((line) => ({
      id: line.id,
      itemId: line.itemId,
      sku: line.sku,
      name: line.name,
      quantity: String(line.quantity),
      unitPrice: line.unitPrice.toFixed(2),
      subtotal: line.subtotal.toFixed(2),
    })),
    operations: row.operations.map((operation) => ({
      id: operation.id,
      kind: operation.kind,
      status: operation.status,
      error: operation.error,
      createdAt: operation.createdAt.toISOString(),
      updatedAt: operation.updatedAt.toISOString(),
    })),
  });
@Injectable()
export class FinanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FinanceService.name);
  private timer?: ReturnType<typeof setInterval>;
  private recovering = false;
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(InventoryClient) private readonly inventory: InventoryClient,
  ) {}
  onModuleInit() {
    this.timer = setInterval(() => void this.recover(), 15000);
    this.timer.unref();
    void this.recover();
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }
  async recover() {
    if (this.recovering) return;
    this.recovering = true;
    try {
      const pending = await this.db.saleOperation.findMany({
        where: { status: 'PENDING' },
        orderBy: { updatedAt: 'asc' },
        take: 20,
      });
      for (const operation of pending) {
        try {
          await this.resolve(operation);
        } catch {
          await this.db.saleOperation.updateMany({
            where: { id: operation.id, status: 'PENDING' },
            data: {
              error: 'Confirmación pendiente; se reintentará automáticamente.',
              updatedAt: new Date(),
            },
          });
        }
      }
    } catch {
      /* readiness expone la indisponibilidad */
    } finally {
      this.recovering = false;
    }
  }
  private async accountDTO(id: string) {
    const row = await this.db.moneyAccount.findUnique({ where: { id } });
    if (!row) throw new FinanceError('NOT_FOUND', 404, 'Cuenta no encontrada.');
    const groups = await this.db.financeMovement.groupBy({
      by: ['direction'],
      where: { accountId: id, status: 'CONFIRMED' },
      _sum: { amount: true },
    });
    const Exact = Prisma.Decimal.clone({ precision: 80 });
    const balance = groups.reduce(
      (sum, group) =>
        group.direction === 'CREDIT'
          ? sum.plus(group._sum.amount ?? 0)
          : sum.minus(group._sum.amount ?? 0),
      new Exact(0),
    );
    return moneyAccountV1Schema.parse({
      ...row,
      balance: balance.toFixed(2),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      archivedAt: row.archivedAt?.toISOString() ?? null,
    });
  }
  async accounts(query: AccountFiltersV1) {
    const where: Prisma.MoneyAccountWhereInput = {
      ...(query.active ? { active: query.active === 'true' } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { code: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, totalItems] = await this.db.$transaction(
      [
        this.db.moneyAccount.findMany({
          where,
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        this.db.moneyAccount.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return {
      data: await Promise.all(rows.map((row) => this.accountDTO(row.id))),
      pagination: pagination(query, totalItems),
    };
  }
  async createAccount(data: CreateMoneyAccountV1) {
    try {
      const row = await this.db.moneyAccount.create({
        data: { ...data, description: data.description ?? null },
      });
      return this.accountDTO(row.id);
    } catch (error) {
      databaseError(error);
    }
  }
  async updateAccount(id: string, data: UpdateMoneyAccountV1) {
    const { expectedVersion, ...values } = data;
    try {
      const changed = await this.db.moneyAccount.updateMany({
        where: { id, version: expectedVersion },
        data: { ...values, version: { increment: 1 } },
      });
      if (changed.count !== 1) throw conflict();
      return this.accountDTO(id);
    } catch (error) {
      databaseError(error);
    }
  }
  async setAccountActive(id: string, expectedVersion: number, active: boolean) {
    try {
      const changed = await this.db.moneyAccount.updateMany({
        where: { id, version: expectedVersion, active: !active },
        data: {
          active,
          archivedAt: active ? null : new Date(),
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw conflict();
      return this.accountDTO(id);
    } catch (error) {
      databaseError(error);
    }
  }
  private async requireAccount(tx: Prisma.TransactionClient, id: string) {
    const account = await tx.moneyAccount.findUnique({ where: { id } });
    if (!account)
      throw new FinanceError('NOT_FOUND', 404, 'Cuenta no encontrada.', [
        'accountId',
      ]);
    if (!account.active)
      throw new FinanceError(
        'INACTIVE_ACCOUNT',
        409,
        'La cuenta está archivada.',
        ['accountId'],
      );
  }
  async movements(query: FinanceMovementFiltersV1) {
    const where: Prisma.FinanceMovementWhereInput = {
      accountId: query.accountId,
      kind: query.kind,
      status: 'CONFIRMED',
      occurredAt: { gte: query.from, lte: query.to },
      ...(query.search
        ? {
            OR: [
              { reference: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, totalItems] = await this.db.$transaction(
      [
        this.db.financeMovement.findMany({
          where,
          include: movementInclude,
          orderBy: [{ occurredAt: 'desc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        this.db.financeMovement.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return {
      data: rows.map(movementDTO),
      pagination: pagination(query, totalItems),
    };
  }
  async createMovement(data: ManualMovementInputV1, actorId: string) {
    try {
      return await this.db.$transaction(
        async (tx) => {
          const existing = await tx.financeMovement.findUnique({
            where: { operationId: data.operationId },
            include: movementInclude,
          });
          if (existing) return movementDTO(existing);
          await this.requireAccount(tx, data.accountId);
          return movementDTO(
            await tx.financeMovement.create({
              data: {
                ...data,
                reference: data.reference ?? null,
                direction:
                  data.kind === 'ADDITIONAL_INCOME' ? 'CREDIT' : 'DEBIT',
                actorId,
              },
              include: movementInclude,
            }),
          );
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      databaseError(error);
    }
  }
  async createPayment(data: PurchasePaymentInputV1, actorId: string) {
    const snapshot = await this.inventory.purchase(data.purchaseId);
    if (snapshot.status !== 'RECEIVED')
      throw new FinanceError(
        'PURCHASE_NOT_PAYABLE',
        409,
        'Solo se pagan compras recibidas.',
      );
    try {
      const id = await this.db.$transaction(
        async (tx) => {
          await tx.$queryRaw(
            Prisma.sql`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${data.purchaseId}, 0))`,
          );
          const existing = await tx.purchasePayment.findUnique({
            where: { operationId: data.operationId },
          });
          if (existing) return existing.id;
          await this.requireAccount(tx, data.accountId);
          const paid = await tx.purchasePayment.aggregate({
            where: { purchaseId: data.purchaseId },
            _sum: { amount: true },
          });
          const Exact = Prisma.Decimal.clone({ precision: 80 });
          if (
            new Exact(paid._sum.amount?.toFixed() ?? '0')
              .plus(data.amount)
              .gt(snapshot.total)
          )
            throw new FinanceError(
              'PURCHASE_OVERPAYMENT',
              409,
              'El pago supera el saldo pendiente de la compra.',
              ['amount'],
            );
          const movement = await tx.financeMovement.create({
            data: {
              operationId: data.operationId,
              accountId: data.accountId,
              kind: 'PURCHASE_PAYMENT',
              direction: 'DEBIT',
              amount: data.amount,
              paymentMethod: data.paymentMethod,
              occurredAt: data.occurredAt,
              reference: data.reference ?? snapshot.reference,
              description:
                data.description ?? 'Pago de compra ' + snapshot.reference,
              actorId,
            },
          });
          const payment = await tx.purchasePayment.create({
            data: {
              operationId: data.operationId,
              purchaseId: data.purchaseId,
              accountId: data.accountId,
              movementId: movement.id,
              amount: data.amount,
              paymentMethod: data.paymentMethod,
              occurredAt: data.occurredAt,
              reference: data.reference ?? null,
              description: data.description ?? null,
              actorId,
              purchaseSnapshot: snapshot as unknown as Prisma.InputJsonValue,
              checkedAt: new Date(),
            },
          });
          return payment.id;
        },
        { isolationLevel: 'Serializable', timeout: 10000 },
      );
      return this.payment(id);
    } catch (error) {
      databaseError(error);
    }
  }
  private async payment(id: string) {
    const row = await this.db.purchasePayment.findUnique({
      where: { id },
      include: paymentInclude,
    });
    if (!row) throw new FinanceError('NOT_FOUND', 404, 'Pago no encontrado.');
    return paymentDTO(row);
  }
  async payments(query: PaymentFiltersV1) {
    const where: Prisma.PurchasePaymentWhereInput = {
      purchaseId: query.purchaseId,
      discrepancy:
        query.discrepancy === undefined
          ? undefined
          : query.discrepancy === 'true',
      occurredAt: { gte: query.from, lte: query.to },
    };
    const [initial, totalItems] = await this.db.$transaction(
      [
        this.db.purchasePayment.findMany({
          where,
          include: paymentInclude,
          orderBy: [{ occurredAt: 'desc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        this.db.purchasePayment.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    await Promise.allSettled(initial.map((row) => this.checkPayment(row.id)));
    const rows = await this.db.purchasePayment.findMany({
      where: { id: { in: initial.map((row) => row.id) } },
      include: paymentInclude,
      orderBy: [{ occurredAt: 'desc' }, { id: 'asc' }],
    });
    return {
      data: rows.map(paymentDTO),
      pagination: pagination(query, totalItems),
    };
  }
  async checkPayment(id: string) {
    const row = await this.db.purchasePayment.findUnique({ where: { id } });
    if (!row) throw new FinanceError('NOT_FOUND', 404, 'Pago no encontrado.');
    const stored = purchaseSnapshotV1Schema.parse(row.purchaseSnapshot);
    const current = await this.inventory.purchase(row.purchaseId);
    const mismatch =
      current.status !== 'RECEIVED' ||
      current.total !== stored.total ||
      current.reference !== stored.reference;
    const reason =
      current.status !== 'RECEIVED'
        ? 'La compra ya no está recibida; el pago histórico requiere regularización.'
        : mismatch
          ? 'La compra cambió después del pago; revisa la instantánea verificada.'
          : null;
    await this.db.purchasePayment.update({
      where: { id },
      data: {
        discrepancy: mismatch,
        discrepancyReason: reason,
        checkedAt: new Date(),
        ...(mismatch
          ? {}
          : {
              regularizedAt: null,
              regularizedBy: null,
              regularizationNote: null,
            }),
      },
    });
    return this.payment(id);
  }
  async regularizePayment(id: string, note: string, actorId: string) {
    const changed = await this.db.purchasePayment.updateMany({
      where: { id, discrepancy: true },
      data: {
        regularizedAt: new Date(),
        regularizedBy: actorId,
        regularizationNote: note,
      },
    });
    if (changed.count !== 1)
      throw new FinanceError(
        'INVALID_STATE',
        409,
        'El pago no tiene una discrepancia pendiente.',
      );
    return this.payment(id);
  }
  saleableItems(search = '', page = 1, pageSize = 100) {
    return this.inventory.items(search, page, pageSize);
  }
  async sales(query: SaleFiltersV1) {
    const where: Prisma.SaleWhereInput = {
      status: query.status,
      occurredAt: { gte: query.from, lte: query.to },
      ...(query.search
        ? {
            OR: [
              { reference: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, totalItems] = await this.db.$transaction(
      [
        this.db.sale.findMany({
          where,
          include: saleInclude,
          orderBy: [{ occurredAt: 'desc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        this.db.sale.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return {
      data: rows.map(saleDTO),
      pagination: pagination(query, totalItems),
    };
  }
  async sale(id: string) {
    const row = await this.db.sale.findUnique({
      where: { id },
      include: saleInclude,
    });
    if (!row) throw new FinanceError('NOT_FOUND', 404, 'Venta no encontrada.');
    return saleDTO(row);
  }
  async createSale(data: CreateSaleV1, actorId: string) {
    const existing = await this.db.saleOperation.findUnique({
      where: { id: data.operationId },
    });
    if (existing) {
      if (existing.status === 'PENDING') await this.resolve(existing);
      return this.sale(existing.saleId);
    }
    const items = await Promise.all(
      data.lines.map((line) => this.inventory.item(line.itemId)),
    );
    const amounts = saleAmounts(data.lines);
    let operation: SaleOperation;
    try {
      operation = await this.db.$transaction(
        async (tx) => {
          await this.requireAccount(tx, data.accountId);
          const saleId = randomUUID();
          const payload = saleStockRequestV1Schema.parse({
            operationId: data.operationId,
            saleId,
            kind: 'CONFIRM',
            actorId,
            reason: 'Venta manual ' + (data.reference ?? saleId),
            lines: data.lines.map((line) => ({
              itemId: line.itemId,
              quantity: line.quantity,
            })),
          });
          await tx.sale.create({
            data: {
              id: saleId,
              accountId: data.accountId,
              subtotal: amounts.subtotal,
              total: amounts.total,
              paymentMethod: data.paymentMethod,
              occurredAt: data.occurredAt,
              reference: data.reference ?? null,
              description: data.description ?? null,
              actorId,
              lines: {
                create: amounts.lines.map((line) => {
                  const item = items.find(
                    (candidate) => candidate.id === line.itemId,
                  )!;
                  return {
                    itemId: line.itemId,
                    sku: item.sku,
                    name: item.name,
                    quantity: line.quantityNumber,
                    unitPrice: line.unitPrice,
                    subtotal: line.subtotal,
                  };
                }),
              },
            },
          });
          return tx.saleOperation.create({
            data: { id: data.operationId, saleId, kind: 'CONFIRM', payload },
          });
        },
        { isolationLevel: 'Serializable', timeout: 10000 },
      );
    } catch (error) {
      if (!(error instanceof FinanceError))
        this.logger.error(
          'Fallo inesperado al persistir una solicitud de venta.',
          error instanceof Error ? error.stack : undefined,
        );
      databaseError(error);
    }
    await this.resolve(operation);
    return this.sale(operation.saleId);
  }
  async cancelSale(id: string, data: CancelSaleV1, actorId: string) {
    let operation: SaleOperation;
    try {
      operation = await this.db.$transaction(
        async (tx) => {
          const duplicate = await tx.saleOperation.findUnique({
            where: { id: data.operationId },
          });
          if (duplicate) {
            if (duplicate.saleId !== id || duplicate.kind !== 'CANCEL')
              throw new FinanceError(
                'DUPLICATE_OPERATION',
                409,
                'El identificador pertenece a otra operación.',
              );
            return duplicate;
          }
          const sale = await tx.sale.findUnique({
            where: { id },
            include: saleInclude,
          });
          if (!sale)
            throw new FinanceError('NOT_FOUND', 404, 'Venta no encontrada.');
          if (sale.version !== data.expectedVersion) throw conflict();
          if (
            sale.status !== 'CONFIRMED' ||
            sale.operations.some((candidate) => candidate.status === 'PENDING')
          )
            throw new FinanceError(
              'INVALID_STATE',
              409,
              'Solo puedes anular una venta confirmada sin operaciones pendientes.',
            );
          const original = sale.operations.find(
            (candidate) =>
              candidate.kind === 'CONFIRM' && candidate.status === 'CONFIRMED',
          )!;
          const payload = saleStockRequestV1Schema.parse({
            operationId: data.operationId,
            saleId: id,
            kind: 'CANCEL',
            actorId,
            reason: data.reason,
            originalOperationId: original.id,
            lines: sale.lines.map((line) => ({
              itemId: line.itemId,
              quantity: String(line.quantity),
            })),
          });
          const changed = await tx.sale.updateMany({
            where: { id, version: data.expectedVersion, status: 'CONFIRMED' },
            data: { status: 'CANCELLATION_PENDING', version: { increment: 1 } },
          });
          if (changed.count !== 1) throw conflict();
          return tx.saleOperation.create({
            data: {
              id: data.operationId,
              saleId: id,
              kind: 'CANCEL',
              originalOperationId: original.id,
              payload,
            },
          });
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      databaseError(error);
    }
    await this.resolve(operation);
    return this.sale(id);
  }
  async reconcile(id: string) {
    const pending = await this.db.saleOperation.findMany({
      where: { saleId: id, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
    });
    if (!pending.length) await this.sale(id);
    for (const operation of pending) await this.resolve(operation);
    return this.sale(id);
  }
  async resolve(operation: SaleOperation) {
    const payload: SaleStockRequestV1 = saleStockRequestV1Schema.parse(
      operation.payload,
    );
    const result = await this.inventory.execute(payload);
    if (
      result.operationId !== operation.id ||
      result.saleId !== operation.saleId
    )
      throw new FinanceError(
        'INVENTORY_UNAVAILABLE',
        503,
        'Inventory respondió con una operación incompatible.',
      );
    try {
      await this.db.$transaction(
        async (tx) => {
          const applied = await tx.saleOperation.updateMany({
            where: { id: operation.id, status: 'PENDING' },
            data: {
              status: result.status,
              result: result as unknown as Prisma.InputJsonValue,
              error: result.error,
            },
          });
          if (applied.count === 0) return;
          const sale = await tx.sale.findUnique({
            where: { id: operation.saleId },
            include: { movements: true },
          });
          if (!sale)
            throw new FinanceError('NOT_FOUND', 404, 'Venta no encontrada.');
          if (result.status === 'CONFIRMED') {
            if (operation.kind === 'CONFIRM') {
              await tx.financeMovement.create({
                data: {
                  operationId: operation.id,
                  accountId: sale.accountId,
                  kind: 'SALE_INCOME',
                  direction: 'CREDIT',
                  amount: sale.total,
                  paymentMethod: sale.paymentMethod,
                  occurredAt: sale.occurredAt,
                  reference: sale.reference,
                  description: sale.description ?? 'Ingreso por venta manual',
                  actorId: sale.actorId,
                  saleId: sale.id,
                },
              });
              await tx.sale.update({
                where: { id: sale.id },
                data: {
                  status: 'CONFIRMED',
                  confirmedAt: new Date(),
                  version: { increment: 1 },
                },
              });
            } else {
              const original = sale.movements.find(
                (movement) => movement.kind === 'SALE_INCOME',
              );
              if (!original)
                throw new FinanceError(
                  'INVALID_STATE',
                  409,
                  'La venta no tiene ingreso confirmado.',
                );
              await tx.financeMovement.create({
                data: {
                  operationId: operation.id,
                  accountId: sale.accountId,
                  kind: 'SALE_REFUND',
                  direction: 'DEBIT',
                  amount: sale.total,
                  paymentMethod: sale.paymentMethod,
                  occurredAt: new Date(),
                  reference: sale.reference,
                  description: 'Devolución por anulación: ' + payload.reason,
                  actorId: payload.actorId,
                  saleId: sale.id,
                  reversesId: original.id,
                },
              });
              await tx.sale.update({
                where: { id: sale.id },
                data: {
                  status: 'CANCELLED',
                  cancelledAt: new Date(),
                  cancellationReason: payload.reason,
                  version: { increment: 1 },
                },
              });
            }
          } else {
            await tx.sale.update({
              where: { id: sale.id },
              data: {
                status: operation.kind === 'CONFIRM' ? 'REJECTED' : 'CONFIRMED',
                version: { increment: 1 },
              },
            });
          }
        },
        { isolationLevel: 'Serializable', timeout: 10000 },
      );
    } catch (error) {
      if (!(error instanceof FinanceError))
        this.logger.error(
          'Fallo inesperado al confirmar localmente una operación de venta.',
          error instanceof Error ? error.stack : undefined,
        );
      databaseError(error);
    }
  }
}
