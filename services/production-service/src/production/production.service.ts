import {
  Inject,
  Injectable,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  consumptionRequestV1Schema,
  yieldInventoryRequestV1Schema,
  packagingInventoryRequestV1Schema,
  formulaV1Schema,
  productionV1Schema,
  productionYieldV1Schema,
  packagingV1Schema,
  ingredientsV1Schema,
  type FormulaInputV1,
  type FormulaFiltersV1,
  type ProductionFiltersV1,
  type ProductionInputV1,
  type ProductionYieldInputV1,
  type PackagingInputV1,
  type ProductionStockRequestV1,
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
  yieldMetrics,
  packagedProductQuantity,
} from './domain';
const include = {
  formulaRevision: true,
  yields: {
    orderBy: [{ createdAt: 'desc' as const }, { id: 'asc' as const }],
    take: 1,
  },
  packagingOperations: {
    orderBy: [{ occurredAt: 'desc' as const }, { id: 'asc' as const }],
  },
  operations: {
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
  },
};
type Order = Prisma.ProductionOrderGetPayload<{ include: typeof include }>;
const yieldDTO = (r: Order['yields'][number]) =>
  productionYieldV1Schema.parse({
    ...r,
    plannedQuantity: r.plannedQuantity.toFixed(),
    actualQuantity: r.actualQuantity.toFixed(),
    differenceQuantity: r.differenceQuantity.toFixed(),
    yieldPercentage: r.yieldPercentage.toFixed(),
    wasteQuantity: r.wasteQuantity.toFixed(),
    wastePercentage: r.wastePercentage.toFixed(),
    occurredAt: r.occurredAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  });
const packagingDTO = (r: Order['packagingOperations'][number]) =>
  packagingV1Schema.parse({
    ...r,
    unitsPackaged: r.unitsPackaged.toFixed(),
    productQuantityPerUnit: r.productQuantityPerUnit.toFixed(),
    productQuantityUsed: r.productQuantityUsed.toFixed(),
    occurredAt: r.occurredAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  });
const dto = (r: Order) => {
  const {
    formulaRevision,
    formulaRevisionId: _formulaRevisionId,
    yields,
    packagingOperations,
    operations,
    ...row
  } = r;
  void _formulaRevisionId;
  return productionV1Schema.parse({
    ...row,
    formulaId: formulaRevision.formulaId,
    formula: formulaRevision.snapshot,
    quantity: r.quantity.toFixed(),
    scheduledAt: r.scheduledAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    startedAt: r.startedAt?.toISOString() ?? null,
    completedAt: r.completedAt?.toISOString() ?? null,
    cancelledAt: r.cancelledAt?.toISOString() ?? null,
    operations: operations.map((operation) => ({
      id: operation.id,
      kind: operation.kind,
      status: operation.status,
      error: operation.error,
      result: operation.result,
      createdAt: operation.createdAt.toISOString(),
      updatedAt: operation.updatedAt.toISOString(),
    })),
    yield: yields[0] ? yieldDTO(yields[0]) : null,
    packagingOperations: packagingOperations.map(packagingDTO),
  });
};
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
  async recordYield(id: string, data: ProductionYieldInputV1, actorId: string) {
    try {
      const operation = await this.db.$transaction(
        async (tx) => {
          const row = await tx.productionOrder.findUnique({
            where: { id },
            include,
          });
          this.editable(row, data.expectedVersion, 'COMPLETED');
          if (row!.yields.some((result) => result.status !== 'REJECTED'))
            throw new ProductionError(
              'DUPLICATE_YIELD',
              409,
              'El lote ya tiene un rendimiento pendiente o confirmado.',
            );
          const formula = formulaV1Schema.parse(row!.formulaRevision.snapshot);
          const metrics = yieldMetrics(
            row!.quantity.toFixed(),
            data.actualQuantity,
            data.wasteQuantity,
          );
          const operationId = randomUUID();
          const payload = yieldInventoryRequestV1Schema.parse({
            operationId,
            productionId: id,
            actorId,
            kind: 'YIELD',
            reason: 'Rendimiento confirmado del lote ' + row!.batch,
            output: {
              itemId: formula.productId,
              quantity: metrics.actualQuantity,
              baseUnit: formula.baseUnit,
            },
          });
          const created = await tx.productionOperation.create({
            data: { id: operationId, orderId: id, kind: 'YIELD', payload },
          });
          await tx.productionYield.create({
            data: {
              orderId: id,
              operationId,
              productId: formula.productId,
              ...metrics,
              baseUnit: formula.baseUnit,
              occurredAt: data.occurredAt,
              actorId,
              notes: data.notes ?? null,
              wasteReason: data.wasteReason ?? null,
            },
          });
          const changed = await tx.productionOrder.updateMany({
            where: { id, version: data.expectedVersion },
            data: { version: { increment: 1 } },
          });
          if (changed.count !== 1) throw conflict();
          return created;
        },
        { isolationLevel: 'Serializable' },
      );
      await this.resolve(operation);
      return this.get(id);
    } catch (error) {
      databaseError(error);
    }
  }
  async package(data: PackagingInputV1, actorId: string) {
    const presentation = await this.inventory.item(data.presentationProductId);
    if (
      !presentation?.active ||
      !presentation.trackInventory ||
      presentation.itemType !== 'FINISHED_PRODUCT' ||
      presentation.inventoryBaseUnit !== 'UNIT' ||
      !presentation.nominalCapacityValue ||
      !presentation.nominalCapacityUnit
    )
      throw new ProductionError(
        'INVALID_PRESENTATION',
        400,
        'Selecciona un producto terminado por unidad con capacidad nominal explícita.',
      );
    for (const material of data.materials) {
      const item = await this.inventory.item(material.itemId);
      if (
        !item?.active ||
        !item.trackInventory ||
        item.itemType !== 'PACKAGING' ||
        item.inventoryBaseUnit !== 'UNIT'
      )
        throw new ProductionError(
          'INVALID_PACKAGING',
          400,
          'Todos los materiales deben ser empaques activos controlados por unidad.',
        );
    }
    try {
      const operation = await this.db.$transaction(
        async (tx) => {
          const row = await tx.productionOrder.findUnique({
            where: { id: data.orderId },
            include,
          });
          this.editable(row, data.expectedVersion, 'COMPLETED');
          const result = row!.yields.find(
            (candidate) => candidate.status === 'CONFIRMED',
          );
          if (!result)
            throw new ProductionError(
              'YIELD_REQUIRED',
              409,
              'Confirma primero el rendimiento del lote.',
            );
          const Exact = Prisma.Decimal.clone({ precision: 80 });
          const units = new Exact(data.unitsPackaged);
          const usedText = packagedProductQuantity(
            data.unitsPackaged,
            data.productQuantityPerUnit,
          );
          const formula = formulaV1Schema.parse(row!.formulaRevision.snapshot);
          const allocated = row!.packagingOperations
            .filter((candidate) => candidate.status !== 'REJECTED')
            .reduce(
              (sum, candidate) =>
                sum.plus(candidate.productQuantityUsed.toFixed()),
              new Exact(0),
            );
          if (allocated.plus(usedText).gt(result.actualQuantity.toFixed()))
            throw new ProductionError(
              'INSUFFICIENT_BATCH_YIELD',
              409,
              'El envasado supera el rendimiento disponible de este lote.',
            );
          const operationId = randomUUID();
          const payload = packagingInventoryRequestV1Schema.parse({
            operationId,
            productionId: data.orderId,
            actorId,
            kind: 'PACKAGE',
            reason: 'Envasado del lote ' + row!.batch,
            source: {
              itemId: result.productId,
              quantity: usedText,
              baseUnit: result.baseUnit,
            },
            materials: data.materials.map((material) => ({
              ...material,
              baseUnit: 'UNIT' as const,
            })),
            output: {
              itemId: data.presentationProductId,
              quantity: units.toFixed(),
              baseUnit: 'UNIT',
            },
          });
          const created = await tx.productionOperation.create({
            data: {
              id: operationId,
              orderId: data.orderId,
              kind: 'PACKAGE',
              payload,
            },
          });
          await tx.packagingOperation.create({
            data: {
              orderId: data.orderId,
              yieldId: result.id,
              operationId,
              bulkProductId: formula.productId,
              presentationProductId: data.presentationProductId,
              unitsPackaged: units.toFixed(),
              productQuantityPerUnit: data.productQuantityPerUnit,
              productQuantityUsed: usedText,
              baseUnit: result.baseUnit,
              materials: payload.materials,
              occurredAt: data.occurredAt,
              actorId,
              notes: data.notes ?? null,
            },
          });
          const changed = await tx.productionOrder.updateMany({
            where: { id: data.orderId, version: data.expectedVersion },
            data: { version: { increment: 1 } },
          });
          if (changed.count !== 1) throw conflict();
          return created;
        },
        { isolationLevel: 'Serializable' },
      );
      await this.resolve(operation);
      return this.get(data.orderId);
    } catch (error) {
      databaseError(error);
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
    const payload: ProductionStockRequestV1 =
      operation.kind === 'CONSUME' || operation.kind === 'REVERSE'
        ? consumptionRequestV1Schema.parse(operation.payload)
        : operation.kind === 'YIELD'
          ? yieldInventoryRequestV1Schema.parse(operation.payload)
          : packagingInventoryRequestV1Schema.parse(operation.payload);
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
        if (operation.kind === 'YIELD')
          await tx.productionYield.update({
            where: { operationId: operation.id },
            data: {
              status: result.status,
              version: { increment: 1 },
            },
          });
        if (operation.kind === 'PACKAGE')
          await tx.packagingOperation.update({
            where: { operationId: operation.id },
            data: {
              status: result.status,
              version: { increment: 1 },
            },
          });
        await tx.productionOrder.update({
          where: { id: operation.orderId },
          data: {
            version: { increment: 1 },
            ...(result.status === 'CONFIRMED' &&
            (operation.kind === 'CONSUME' || operation.kind === 'REVERSE')
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
