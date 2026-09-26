import { Inject, Injectable } from '@nestjs/common';
import {
  consumptionRequestV1Schema,
  consumptionResultV1Schema,
  productionStockRequestV1Schema,
  type ConsumptionResultV1,
  type ProductionStockRequestV1,
} from '@ambrosia/contracts';
import { PrismaService } from '../prisma.service';
import { Prisma } from '../generated/prisma/client';
import { StockService } from '../purchases/stock.service';
import { PurchaseError, databaseError, parse } from '../purchases/domain';
@Injectable()
export class ProductionStockService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(StockService) private readonly stock: StockService,
  ) {}
  async get(id: string) {
    const row = await this.db.productionStockOperation.findUnique({
      where: { id },
    });
    if (!row)
      throw new PurchaseError(
        'ITEM_NOT_FOUND',
        404,
        'Operación no encontrada.',
      );
    return consumptionResultV1Schema.parse(row.result);
  }
  private async executeYieldOrPackaging(
    data: Extract<ProductionStockRequestV1, { kind: 'YIELD' | 'PACKAGE' }>,
  ) {
    if (data.kind === 'PACKAGE')
      data.materials.sort((a, b) => a.itemId.localeCompare(b.itemId));
    try {
      return await this.db.$transaction(
        async (tx) => {
          await tx.$queryRaw(
            Prisma.sql`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${data.productionId}, 0))`,
          );
          const existing = await tx.productionStockOperation.findUnique({
            where: { id: data.operationId },
          });
          if (existing) {
            const original = parse(
              productionStockRequestV1Schema,
              existing.payload,
            );
            if (JSON.stringify(original) !== JSON.stringify(data))
              throw new PurchaseError(
                'DUPLICATE_OPERATION',
                409,
                'El identificador pertenece a otra solicitud.',
              );
            return consumptionResultV1Schema.parse(existing.result);
          }
          const result: ConsumptionResultV1 = {
            operationId: data.operationId,
            productionId: data.productionId,
            status: 'CONFIRMED',
            error: null,
            movements: [],
          };
          type Line = {
            itemId: string;
            quantity: string;
            baseUnit: 'UNIT' | 'GRAM' | 'MILLILITER';
            type:
              | 'PRODUCTION_IN'
              | 'PRODUCTION_OUT'
              | 'PACKAGING_OUT'
              | 'PACKAGED_PRODUCT_IN';
          };
          const lines: Line[] =
            data.kind === 'YIELD'
              ? [{ ...data.output, type: 'PRODUCTION_IN' }]
              : [
                  { ...data.source, type: 'PRODUCTION_OUT' },
                  ...data.materials.map((line) => ({
                    ...line,
                    type: 'PACKAGING_OUT' as const,
                  })),
                  { ...data.output, type: 'PACKAGED_PRODUCT_IN' },
                ];
          lines.sort((a, b) => a.itemId.localeCompare(b.itemId));
          try {
            if (
              data.kind === 'YIELD' &&
              (
                await tx.productionStockOperation.findMany({
                  where: { productionId: data.productionId, kind: 'YIELD' },
                })
              ).some(
                (operation) =>
                  consumptionResultV1Schema.parse(operation.result).status ===
                  'CONFIRMED',
              )
            )
              throw new PurchaseError(
                'DUPLICATE_OPERATION',
                409,
                'El rendimiento del lote ya ingresó a existencias.',
              );
            const items = await this.stock.lockItems(
              tx,
              lines.map((line) => line.itemId),
            );
            const Exact = Prisma.Decimal.clone({ precision: 80 });
            for (const line of lines) {
              const item = items.find(
                (candidate) => candidate.id === line.itemId,
              )!;
              this.stock.requireTracked(item);
              if (item.inventoryBaseUnit !== line.baseUnit)
                throw new PurchaseError(
                  'VALIDATION_ERROR',
                  400,
                  'La unidad de uno de los artículos cambió.',
                );
              if (
                (line.type === 'PRODUCTION_IN' ||
                  line.type === 'PACKAGED_PRODUCT_IN') &&
                item.itemType !== 'FINISHED_PRODUCT'
              )
                throw new PurchaseError(
                  'VALIDATION_ERROR',
                  400,
                  'Las entradas deben corresponder a productos terminados.',
                );
              if (
                line.type === 'PACKAGING_OUT' &&
                (item.itemType !== 'PACKAGING' ||
                  item.inventoryBaseUnit !== 'UNIT')
              )
                throw new PurchaseError(
                  'VALIDATION_ERROR',
                  400,
                  'Los materiales deben ser artículos de empaque controlados por unidad.',
                );
              if (
                data.kind === 'PACKAGE' &&
                line.itemId === data.source.itemId &&
                item.itemType !== 'FINISHED_PRODUCT'
              )
                throw new PurchaseError(
                  'VALIDATION_ERROR',
                  400,
                  'El origen del envasado debe ser un producto terminado a granel.',
                );
              const balance = await tx.inventoryBalance.findUnique({
                where: { itemId: line.itemId },
              });
              const current = new Exact(balance?.quantity.toFixed() ?? '0');
              const outgoing =
                line.type === 'PRODUCTION_OUT' || line.type === 'PACKAGING_OUT';
              if (outgoing && current.lt(line.quantity))
                throw new PurchaseError(
                  'INSUFFICIENT_STOCK',
                  409,
                  'Existencias insuficientes de producto o materiales de empaque.',
                );
              if (
                !outgoing &&
                current.plus(line.quantity).gte('100000000000000')
              )
                throw new PurchaseError(
                  'DECIMAL_OVERFLOW',
                  409,
                  'La entrada excedería la precisión del saldo.',
                );
            }
            if (data.kind === 'PACKAGE') {
              const output = items.find(
                (item) => item.id === data.output.itemId,
              )!;
              const units = new Exact(data.output.quantity);
              if (
                output.inventoryBaseUnit !== 'UNIT' ||
                !units.isInteger() ||
                !output.nominalCapacityValue ||
                !output.nominalCapacityUnit
              )
                throw new PurchaseError(
                  'VALIDATION_ERROR',
                  400,
                  'La presentación debe ser un producto terminado por unidad con capacidad nominal.',
                );
              let nominal = new Exact(output.nominalCapacityValue.toFixed());
              const compatible =
                (data.source.baseUnit === 'GRAM' &&
                  output.nominalCapacityUnit === 'GRAM') ||
                (data.source.baseUnit === 'MILLILITER' &&
                  ['MILLILITER', 'FLUID_OUNCE'].includes(
                    output.nominalCapacityUnit,
                  ));
              if (output.nominalCapacityUnit === 'FLUID_OUNCE')
                nominal = nominal.mul('29.5735295625');
              const explicitPerUnit = new Exact(data.source.quantity).div(
                units,
              );
              if (!compatible || !explicitPerUnit.eq(nominal))
                throw new PurchaseError(
                  'VALIDATION_ERROR',
                  400,
                  'El contenido explícito por unidad no coincide dimensionalmente con la capacidad nominal de la presentación.',
                );
            }
          } catch (error) {
            if (!(error instanceof PurchaseError)) throw error;
            result.status = 'REJECTED';
            result.error = (error.getResponse() as { message: string }).message;
          }
          await tx.productionStockOperation.create({
            data: {
              id: data.operationId,
              productionId: data.productionId,
              kind: data.kind,
              payload: data,
              result: result as unknown as Prisma.InputJsonValue,
            },
          });
          if (result.status === 'CONFIRMED') {
            for (const line of lines)
              result.movements.push(
                await this.stock.record(tx, {
                  ...line,
                  origin: 'PRODUCTION',
                  reference: data.productionId,
                  reason: data.reason,
                  actorId: data.actorId,
                  productionOperationId: data.operationId,
                }),
              );
            await tx.productionStockOperation.update({
              where: { id: data.operationId },
              data: { result: result as unknown as Prisma.InputJsonValue },
            });
          }
          return result;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 10000,
        },
      );
    } catch (error) {
      databaseError(error);
    }
  }
  async execute(input: ProductionStockRequestV1) {
    const data = parse(productionStockRequestV1Schema, input);
    if (data.kind === 'YIELD' || data.kind === 'PACKAGE')
      return this.executeYieldOrPackaging(data);
    data.lines.sort((a, b) => a.itemId.localeCompare(b.itemId));
    try {
      return await this.db.$transaction(
        async (tx) => {
          // All operations for the same production serialize, including alternate operation IDs.
          await tx.$queryRaw(
            Prisma.sql`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${data.productionId}, 0))`,
          );
          const existing = await tx.productionStockOperation.findUnique({
            where: { id: data.operationId },
          });
          if (existing) {
            const original = parse(
              consumptionRequestV1Schema,
              existing.payload,
            );
            if (JSON.stringify(original) !== JSON.stringify(data))
              throw new PurchaseError(
                'DUPLICATE_OPERATION',
                409,
                'El identificador pertenece a otra solicitud.',
              );
            return consumptionResultV1Schema.parse(existing.result);
          }
          const result: ConsumptionResultV1 = {
            operationId: data.operationId,
            productionId: data.productionId,
            status: 'CONFIRMED',
            error: null,
            movements: [],
          };
          const previous = await tx.productionStockOperation.findMany({
            where: { productionId: data.productionId },
          });
          const confirmed = previous.filter(
            (p) =>
              consumptionResultV1Schema.parse(p.result).status === 'CONFIRMED',
          );
          const original = data.originalOperationId
            ? previous.find(
                (p) =>
                  p.id === data.originalOperationId &&
                  p.kind === 'CONSUME' &&
                  consumptionResultV1Schema.parse(p.result).status ===
                    'CONFIRMED',
              )
            : null;
          let originals: Awaited<
            ReturnType<typeof tx.inventoryMovement.findMany>
          > = [];
          try {
            if (
              data.kind === 'CONSUME' &&
              confirmed.some((p) => p.kind === 'CONSUME')
            )
              throw new PurchaseError(
                'DUPLICATE_OPERATION',
                409,
                'La producción ya consumió inventario.',
              );
            if (data.kind === 'REVERSE') {
              if (!original || confirmed.some((p) => p.kind === 'REVERSE'))
                throw new PurchaseError(
                  'DUPLICATE_OPERATION',
                  409,
                  'Consumo inexistente o ya compensado.',
                );
              const request = parse(
                consumptionRequestV1Schema,
                original.payload,
              );
              if (JSON.stringify(request.lines) !== JSON.stringify(data.lines))
                throw new PurchaseError(
                  'VALIDATION_ERROR',
                  400,
                  'Los insumos deben coincidir con el consumo original.',
                );
              originals = await tx.inventoryMovement.findMany({
                where: { productionOperationId: original.id },
                orderBy: { itemId: 'asc' },
              });
            }
            const items = await this.stock.lockItems(
              tx,
              data.lines.map((l) => l.itemId),
            );
            const Exact = Prisma.Decimal.clone({ precision: 80 });
            for (const line of data.lines) {
              const item = items.find((i) => i.id === line.itemId)!;
              if (data.kind === 'CONSUME') this.stock.requireTracked(item);
              if (item.inventoryBaseUnit !== line.baseUnit)
                throw new PurchaseError(
                  'VALIDATION_ERROR',
                  400,
                  'La unidad del insumo cambió.',
                );
              const balance = await tx.inventoryBalance.findUnique({
                where: { itemId: line.itemId },
              });
              const current = new Exact(balance?.quantity.toFixed() ?? '0');
              if (data.kind === 'CONSUME' && current.lt(line.quantity))
                throw new PurchaseError(
                  'INSUFFICIENT_STOCK',
                  409,
                  'Existencias insuficientes para todos los insumos.',
                );
              if (
                data.kind === 'REVERSE' &&
                current.plus(line.quantity).gte('100000000000000')
              )
                throw new PurchaseError(
                  'DECIMAL_OVERFLOW',
                  409,
                  'La compensación excedería la precisión del saldo.',
                );
            }
          } catch (e) {
            if (!(e instanceof PurchaseError)) throw e;
            result.status = 'REJECTED';
            result.error = (e.getResponse() as { message: string }).message;
          }
          await tx.productionStockOperation.create({
            data: {
              id: data.operationId,
              productionId: data.productionId,
              kind: data.kind,
              originalOperationId:
                result.status === 'CONFIRMED' ? data.originalOperationId : null,
              payload: data,
              result: result as unknown as Prisma.InputJsonValue,
            },
          });
          if (result.status === 'CONFIRMED') {
            for (const line of data.lines)
              result.movements.push(
                await this.stock.record(tx, {
                  ...line,
                  type:
                    data.kind === 'CONSUME'
                      ? 'PRODUCTION_OUT'
                      : 'PRODUCTION_RETURN',
                  origin: 'PRODUCTION',
                  reference: data.productionId,
                  reason: data.reason,
                  actorId: data.actorId,
                  productionOperationId: data.operationId,
                  ...(data.kind === 'REVERSE'
                    ? {
                        reversesId: originals.find(
                          (m) => m.itemId === line.itemId,
                        )!.id,
                      }
                    : {}),
                }),
              );
            await tx.productionStockOperation.update({
              where: { id: data.operationId },
              data: { result: result as unknown as Prisma.InputJsonValue },
            });
          }
          return result;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 10000,
        },
      );
    } catch (e) {
      databaseError(e);
    }
  }
}
