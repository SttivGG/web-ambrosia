import {
  Inject,
  Injectable,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  consumptionRequestV1Schema,
  formulaV1Schema,
  productionV1Schema,
  ingredientsV1Schema,
  type FormulaInputV1,
  type FormulaFiltersV1,
  type ProductionFiltersV1,
  type ProductionInputV1,
} from '@ambrosia/contracts';
import { PrismaService } from '../prisma.service';
import {
  Prisma,
  type ProductionOperation,
  type Formula,
  type FormulaRevision,
} from '../generated/prisma/client';
import { InventoryClient } from './inventory.client';
import {
  ProductionError,
  conflict,
  calculate,
  databaseError,
  pagination,
} from './domain';
const include = {
  formulaRevision: true,
  operations: {
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
  },
};
type Order = Prisma.ProductionOrderGetPayload<{ include: typeof include }>;
const dto = (r: Order) =>
  productionV1Schema.parse({
    ...r,
    formulaId: r.formulaRevision.formulaId,
    formula: r.formulaRevision.snapshot,
    quantity: r.quantity.toFixed(),
    scheduledAt: r.scheduledAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    startedAt: r.startedAt?.toISOString() ?? null,
    completedAt: r.completedAt?.toISOString() ?? null,
    cancelledAt: r.cancelledAt?.toISOString() ?? null,
    operations: r.operations.map((o) => ({
      ...o,
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
    })),
  });
const formulaDTO = (r: Formula & { revisions: FormulaRevision[] }) =>
  formulaV1Schema.parse(r.revisions[0]!.snapshot);
@Injectable()
export class ProductionService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(InventoryClient) private readonly inventory: InventoryClient,
  ) {}
  onModuleInit() {
    this.timer = setInterval(() => {
      void this.recover();
    }, 15000);
    this.timer.unref();
    void this.recover();
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }
  async recover() {
    if (this.running) return;
    this.running = true;
    try {
      const rows = await this.db.productionOperation.findMany({
        where: { status: 'PENDING' },
        orderBy: { updatedAt: 'asc' },
        take: 20,
      });
      for (const row of rows) {
        try {
          await this.resolve(row);
        } catch {
          // Rotate failed work so an unavailable operation cannot starve later lots.
          await this.db.productionOperation.updateMany({
            where: { id: row.id, status: 'PENDING' },
            data: {
              error: 'Confirmación pendiente; se reintentará automáticamente.',
              updatedAt: new Date(),
            },
          });
        }
      }
    } catch {
      /* Database readiness reports outages. */
    } finally {
      this.running = false;
    }
  }
  async formulas(q: FormulaFiltersV1) {
    const where: Prisma.FormulaWhereInput = {
      ...(q.active ? { active: q.active === 'true' } : {}),
      ...(q.search
        ? { name: { contains: q.search, mode: 'insensitive' } }
        : {}),
    };
    const [rows, count] = await this.db.$transaction(
      [
        this.db.formula.findMany({
          where,
          include: { revisions: { orderBy: { version: 'desc' }, take: 1 } },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        this.db.formula.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return { data: rows.map(formulaDTO), pagination: pagination(q, count) };
  }
  async formula(id: string) {
    const r = await this.db.formula.findUnique({
      where: { id },
      include: { revisions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    if (!r)
      throw new ProductionError('NOT_FOUND', 404, 'Fórmula no encontrada.');
    return formulaDTO(r);
  }
  async saveFormula(
    data: FormulaInputV1,
    id?: string,
    expectedVersion?: number,
  ) {
    await this.inventory.validateFormula(data);
    try {
      return await this.db.$transaction(
        async (tx) => {
          const now = new Date();
          const formulaId = id ?? randomUUID();
          const revisionId = randomUUID();
          const old = id
            ? await tx.formula.findUnique({ where: { id } })
            : null;
          if (id && (!old || old.version !== expectedVersion)) throw conflict();
          const version = (old?.version ?? 0) + 1;
          if (id) {
            const r = await tx.formula.updateMany({
              where: { id, version: expectedVersion },
              data: { name: data.name, active: data.active, version },
            });
            if (r.count !== 1) throw conflict();
          } else
            await tx.formula.create({
              data: { id: formulaId, name: data.name, active: data.active },
            });
          const snapshot = formulaV1Schema.parse({
            ...data,
            id: formulaId,
            revisionId,
            version,
            createdAt: (old?.createdAt ?? now).toISOString(),
            updatedAt: now.toISOString(),
          });
          await tx.formulaRevision.create({
            data: { id: revisionId, formulaId, version, snapshot },
          });
          return snapshot;
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (e) {
      databaseError(e);
    }
  }
  async list(q: ProductionFiltersV1) {
    const where: Prisma.ProductionOrderWhereInput = {
      status: q.status,
      ...(q.search
        ? { batch: { contains: q.search, mode: 'insensitive' } }
        : {}),
    };
    const [rows, count] = await this.db.$transaction(
      [
        this.db.productionOrder.findMany({
          where,
          include,
          orderBy: [{ scheduledAt: 'desc' }, { id: 'asc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        this.db.productionOrder.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return { data: rows.map(dto), pagination: pagination(q, count) };
  }
  async get(id: string) {
    const row = await this.db.productionOrder.findUnique({
      where: { id },
      include,
    });
    if (!row)
      throw new ProductionError('NOT_FOUND', 404, 'Producción no encontrada.');
    return dto(row);
  }
  private editable(
    row: Order | null,
    expectedVersion: number,
    status = 'DRAFT',
  ) {
    if (!row)
      throw new ProductionError('NOT_FOUND', 404, 'Producción no encontrada.');
    if (row.version !== expectedVersion) throw conflict();
    if (
      row.status !== status ||
      row.operations.some((o) => o.status === 'PENDING')
    )
      throw new ProductionError(
        'INVALID_STATE',
        409,
        'La producción no permite esta acción o tiene una operación pendiente.',
      );
    return row;
  }
  async save(
    data: ProductionInputV1,
    actorId: string,
    id?: string,
    expectedVersion?: number,
  ) {
    try {
      return await this.db.$transaction(
        async (tx) => {
          if (id)
            this.editable(
              await tx.productionOrder.findUnique({ where: { id }, include }),
              expectedVersion!,
            );
          const f = await tx.formula.findUnique({
            where: { id: data.formulaId },
            include: { revisions: { orderBy: { version: 'desc' }, take: 1 } },
          });
          if (!f?.active)
            throw new ProductionError(
              'INVALID_FORMULA',
              409,
              'La fórmula no existe o está inactiva.',
            );
          const formula = formulaDTO(f);
          const values = {
            batch: data.batch,
            formulaRevisionId: formula.revisionId,
            quantity: data.quantity,
            ingredients: calculate(formula.ingredients, data.quantity),
            scheduledAt: data.scheduledAt,
            notes: data.notes ?? null,
          };
          if (id) {
            const r = await tx.productionOrder.updateMany({
              where: { id, version: expectedVersion, status: 'DRAFT' },
              data: { ...values, version: { increment: 1 } },
            });
            if (r.count !== 1) throw conflict();
            return dto(
              (await tx.productionOrder.findUnique({
                where: { id },
                include,
              }))!,
            );
          }
          return dto(
            await tx.productionOrder.create({
              data: { ...values, actorId },
              include,
            }),
          );
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (e) {
      databaseError(e);
    }
  }
  async transition(
    id: string,
    expectedVersion: number,
    action: 'start' | 'complete' | 'cancel',
    actorId: string,
    reason?: string,
  ) {
    try {
      const operation = await this.db.$transaction(
        async (tx) => {
          const row = await tx.productionOrder.findUnique({
            where: { id },
            include,
          });
          if (!row)
            throw new ProductionError(
              'NOT_FOUND',
              404,
              'Producción no encontrada.',
            );
          const pending = row.operations.find((o) => o.status === 'PENDING');
          if (
            pending &&
            ((action === 'start' && pending.kind === 'CONSUME') ||
              (action === 'cancel' && pending.kind === 'REVERSE'))
          )
            return pending;
          this.editable(
            row,
            expectedVersion,
            action === 'start'
              ? 'DRAFT'
              : action === 'complete'
                ? 'IN_PROGRESS'
                : row.status,
          );
          if (
            action === 'cancel' &&
            !['DRAFT', 'IN_PROGRESS'].includes(row.status)
          )
            throw new ProductionError(
              'INVALID_STATE',
              409,
              'No puedes cancelar una producción terminada.',
            );
          if (
            action === 'complete' ||
            (action === 'cancel' && row.status === 'DRAFT')
          ) {
            const r = await tx.productionOrder.updateMany({
              where: { id, version: expectedVersion },
              data: {
                status: action === 'complete' ? 'COMPLETED' : 'CANCELLED',
                version: { increment: 1 },
                ...(action === 'complete'
                  ? { completedAt: new Date() }
                  : { cancelledAt: new Date(), cancellationReason: reason }),
              },
            });
            if (r.count !== 1) throw conflict();
            return null;
          }
          const kind = action === 'start' ? 'CONSUME' : 'REVERSE';
          const payload = consumptionRequestV1Schema.parse({
            operationId: randomUUID(),
            productionId: id,
            kind,
            actorId,
            originalOperationId:
              kind === 'REVERSE'
                ? row.operations.find(
                    (o) => o.kind === 'CONSUME' && o.status === 'CONFIRMED',
                  )?.id
                : null,
            reason: reason ?? 'Consumo de producción ' + row.batch,
            lines: ingredientsV1Schema.parse(row.ingredients),
          });
          const r = await tx.productionOrder.updateMany({
            where: { id, version: expectedVersion },
            data: { version: { increment: 1 } },
          });
          if (r.count !== 1) throw conflict();
          return tx.productionOperation.create({
            data: { id: payload.operationId, orderId: id, kind, payload },
          });
        },
        { isolationLevel: 'Serializable' },
      );
      if (operation) await this.resolve(operation);
      return this.get(id);
    } catch (e) {
      databaseError(e);
    }
  }
  async reconcile(id: string) {
    const row = await this.db.productionOrder.findUnique({
      where: { id },
      include,
    });
    if (!row)
      throw new ProductionError('NOT_FOUND', 404, 'Producción no encontrada.');
    for (const operation of row.operations.filter(
      (o) => o.status === 'PENDING',
    ))
      await this.resolve(operation);
    return this.get(id);
  }
  async resolve(operation: ProductionOperation) {
    const payload = consumptionRequestV1Schema.parse(operation.payload);
    const result = await this.inventory.execute(payload);
    if (
      result.operationId !== operation.id ||
      result.productionId !== operation.orderId
    )
      throw new ProductionError(
        'INVALID_RESPONSE',
        503,
        'Respuesta de inventario no compatible.',
      );
    await this.db.$transaction(
      async (tx) => {
        const applied = await tx.productionOperation.updateMany({
          where: { id: operation.id, status: 'PENDING' },
          data: {
            status: result.status,
            result: result as unknown as Prisma.InputJsonValue,
            error: result.error,
          },
        });
        if (applied.count === 0) return;
        await tx.productionOrder.update({
          where: { id: operation.orderId },
          data: {
            version: { increment: 1 },
            ...(result.status === 'CONFIRMED'
              ? operation.kind === 'CONSUME'
                ? { status: 'IN_PROGRESS', startedAt: new Date() }
                : {
                    status: 'CANCELLED',
                    cancelledAt: new Date(),
                    cancellationReason: payload.reason,
                  }
              : {}),
          },
        });
      },
      { isolationLevel: 'Serializable' },
    );
  }
}
